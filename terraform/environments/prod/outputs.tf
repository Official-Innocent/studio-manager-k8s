output "eks_cluster_name" {
  description = "EKS cluster name — use with: aws eks update-kubeconfig --name <value>"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS API server endpoint"
  value       = module.eks.cluster_endpoint
}

output "rds_host" {
  description = "RDS hostname for application environment variables"
  value       = module.rds.db_host
  sensitive   = true
}

output "rds_port" {
  description = "RDS port"
  value       = module.rds.db_port
}

output "rds_db_name" {
  description = "Database name"
  value       = module.rds.db_name
}

output "s3_uploads_bucket" {
  description = "S3 bucket name for portfolio uploads"
  value       = aws_s3_bucket.uploads.id
}

output "ecr_registry" {
  description = "ECR registry base URL — prefix all image tags with this"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "nat_gateway_ip" {
  description = "NAT Gateway public IP — whitelist this in any external services"
  value       = module.networking.nat_gateway_ip
}

output "guardduty_detector_id" {
  description = "GuardDuty detector ID"
  value       = module.security.guardduty_detector_id
}

output "cloudtrail_bucket" {
  description = "S3 bucket storing CloudTrail audit logs"
  value       = module.security.cloudtrail_bucket
}

output "flow_logs_log_group" {
  description = "CloudWatch Log Group for VPC Flow Logs"
  value       = module.security.flow_logs_log_group
}

output "security_hub_id" {
  description = "Security Hub enabled — check AWS console for findings"
  value       = module.security.security_hub_id
}
