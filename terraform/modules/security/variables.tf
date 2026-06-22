variable "project" {
  description = "Project name used for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID — used for VPC Flow Logs"
  type        = string
}

variable "account_id" {
  description = "AWS account ID — used for CloudTrail bucket policy"
  type        = string
}
