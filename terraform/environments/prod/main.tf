# ── Data Sources ──────────────────────────────────────────────────────────────
# Dynamically fetch the AWS account ID rather than hardcoding it.
# This makes the config portable across accounts (staging, prod, personal).
data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

# ── Networking Module ─────────────────────────────────────────────────────────
# Creates VPC, subnets, IGW, NAT Gateway, and route tables.
# All other modules depend on outputs from this one.
module "networking" {
  source = "../../modules/networking"

  project     = var.project
  environment = var.environment
  vpc_cidr    = var.vpc_cidr

  availability_zones   = slice(data.aws_availability_zones.available.names, 0, 2)
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
}

# ── EKS Module ────────────────────────────────────────────────────────────────
# Creates EKS cluster, managed node group, IAM roles and security groups.
# Depends on networking module for VPC and subnet IDs.
module "eks" {
  source = "../../modules/eks"

  project     = var.project
  environment = var.environment

  vpc_id             = module.networking.vpc_id
  vpc_cidr           = module.networking.vpc_cidr
  private_subnet_ids = module.networking.private_subnet_ids
  public_subnet_ids  = module.networking.public_subnet_ids

  cluster_version    = var.cluster_version
  node_instance_type = var.node_instance_type
  node_desired_size  = var.node_desired_size
  node_min_size      = var.node_min_size
  node_max_size      = var.node_max_size
}

# ── RDS Module ────────────────────────────────────────────────────────────────
# Creates PostgreSQL RDS instance in private subnets.
# Only accessible from EKS worker nodes via security group rule.
module "rds" {
  source = "../../modules/rds"

  project     = var.project
  environment = var.environment

  vpc_id                = module.networking.vpc_id
  private_subnet_ids    = module.networking.private_subnet_ids
  eks_security_group_id = module.eks.cluster_security_group_id

  db_name     = var.db_name
  db_username = var.db_username
  db_password = var.db_password

  db_instance_class    = var.db_instance_class
  db_allocated_storage = var.db_allocated_storage
  postgres_version     = var.postgres_version
}

# ── ECR Repositories ─────────────────────────────────────────────────────────
# One repository per microservice. ECR is used instead of Docker Hub in
# production because:
# - No rate limiting (Docker Hub limits unauthenticated pulls)
# - Images stay within AWS network (faster pulls from EKS, no egress cost)
# - IAM-based access control (no separate registry credentials)
# - Integrated vulnerability scanning via image_scanning_configuration
#
# PRODUCTION NOTE: Add a lifecycle policy to each repo to automatically
# expire old images and control storage costs:
#
# resource "aws_ecr_lifecycle_policy" "main" {
#   for_each   = aws_ecr_repository.bsm_services
#   repository = each.value.name
#   policy = jsonencode({
#     rules = [{
#       rulePriority = 1
#       description  = "Keep last 10 images"
#       selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
#       action       = { type = "expire" }
#     }]
#   })
# }
locals {
  services = [
    "frontend",
    "auth-service",
    "booking-service",
    "content-service",
    "gallery-service",
    "notification-service",
    "portal-service",
    "scheduler-service",
    "monitor-service"
  ]
}

resource "aws_ecr_repository" "bsm_services" {
  for_each             = toset(local.services)
  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Environment = var.environment
    Project     = var.project
    Service     = each.key
  }
}

# ── S3 Bucket for Portfolio Uploads ──────────────────────────────────────────
# Replaces the local filesystem volume used on QNAP/k3s.
# In the AWS deployment, content-service writes uploads here instead of /data.
#
# Account ID appended to bucket name for global uniqueness (S3 bucket names
# are globally unique across all AWS accounts and regions).
#
# PRODUCTION NOTE: Add a bucket policy restricting access to the EKS node
# role only. Also consider CloudFront in front of S3 for image delivery
# (caching, CDN distribution, signed URLs for private images).
resource "aws_s3_bucket" "uploads" {
  bucket        = "${var.project}-uploads-${var.environment}-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# ── Security Module ───────────────────────────────────────────────────────────
# Enables GuardDuty, CloudTrail, VPC Flow Logs, Security Hub, and IAM Access
# Analyzer. Depends on networking module for vpc_id.
# All services are either free or within the 30-day free trial on a new account.
module "security" {
  source = "../../modules/security"

  project     = var.project
  environment = var.environment
  aws_region  = var.aws_region
  vpc_id      = module.networking.vpc_id
  account_id  = data.aws_caller_identity.current.account_id
}
