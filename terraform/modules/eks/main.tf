# ── IAM Role for EKS Control Plane ───────────────────────────────────────────
# EKS needs permission to manage AWS resources on your behalf (e.g. create ENIs,
# describe EC2 instances). This role is assumed by the EKS service itself,
# not by your application pods.
# PRODUCTION NOTE: This is the standard pattern — no changes needed here.
resource "aws_iam_role" "eks_cluster" {
  name = "${var.project}-${var.environment}-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
    }]
  })

  tags = { Environment = var.environment, Project = var.project }
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

# ── IAM Role for EKS Worker Nodes ────────────────────────────────────────────
# Worker nodes (EC2 instances) need permissions to:
# - Join the EKS cluster (AmazonEKSWorkerNodePolicy)
# - Configure pod networking via the VPC CNI plugin (AmazonEKS_CNI_Policy)
# - Pull container images from ECR (AmazonEC2ContainerRegistryReadOnly)
#
# PRODUCTION NOTE: In production you would also set up IRSA (IAM Roles for
# Service Accounts) via an OIDC provider so individual pods assume specific
# minimal IAM roles rather than inheriting all node-level permissions.
# Example: your content-service pod would assume a role with S3 access only,
# rather than all pods on the node inheriting S3 access.
resource "aws_iam_role" "eks_nodes" {
  name = "${var.project}-${var.environment}-eks-nodes-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = { Environment = var.environment, Project = var.project }
}

resource "aws_iam_role_policy_attachment" "eks_worker_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_ecr_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_nodes.name
}

# ── Security Group for EKS Nodes ─────────────────────────────────────────────
# Controls traffic to/from worker nodes.
# Allows all traffic within the VPC CIDR (node-to-node, pod-to-pod, RDS access).
# Allows all outbound (nodes need to pull images, call AWS APIs, etc).
#
# PRODUCTION NOTE: This is intentionally permissive for a demo.
# In production, restrict ingress rules to specific ports and sources:
# - Port 443 from the EKS control plane security group only
# - Port 10250 (kubelet) from the control plane only
# - Application ports only from the ALB security group
# Use separate security groups per service tier (web, app, db).
resource "aws_security_group" "eks_nodes" {
  name        = "${var.project}-${var.environment}-eks-nodes-sg"
  description = "Security group for EKS worker nodes"
  vpc_id      = var.vpc_id

  ingress {
    description = "Allow all traffic within VPC (node-to-node, pod communication)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Allow all outbound (image pulls, AWS API calls, updates)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-${var.environment}-eks-nodes-sg", Environment = var.environment }
}

# ── EKS Cluster ──────────────────────────────────────────────────────────────
# The managed Kubernetes control plane. AWS manages etcd, API server,
# scheduler, controller manager — you only manage worker nodes and workloads.
#
# endpoint_public_access = true: API server reachable from the internet.
# PRODUCTION NOTE: Set endpoint_public_access = false and
# endpoint_private_access = true, then access via VPN or bastion host only.
# If you need public access, restrict it to specific CIDRs:
# public_access_cidrs = ["YOUR_OFFICE_IP/32", "YOUR_CI_IP/32"]
resource "aws_eks_cluster" "main" {
  name     = "${var.project}-${var.environment}-eks"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = var.cluster_version

  vpc_config {
    subnet_ids              = concat(var.public_subnet_ids, var.private_subnet_ids)
    security_group_ids      = [aws_security_group.eks_nodes.id]
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster_policy]

  tags = { Environment = var.environment, Project = var.project }
}

# ── EKS Managed Node Group ────────────────────────────────────────────────────
# Managed node group = AWS handles node provisioning, updates, and termination.
# Nodes run in PRIVATE subnets — they're not directly internet-accessible.
# They reach the internet via NAT Gateway for image pulls and AWS API calls.
#
# instance_types = ["t3.medium"]: 2 vCPU, 4GB RAM per node.
# PRODUCTION NOTE: Right-size based on actual workload profiling.
# For a microservices app with 7+ services, t3.large (2vCPU/8GB) or
# t3.xlarge would be safer for production to avoid OOMKilled pods.
# Use Cluster Autoscaler or Karpenter for dynamic scaling in production.
resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.project}-${var.environment}-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = var.private_subnet_ids
  instance_types  = [var.node_instance_type]

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.eks_ecr_policy,
  ]

  tags = { Environment = var.environment, Project = var.project }
}
