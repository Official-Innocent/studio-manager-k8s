variable "project" {
  description = "Project name used for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where RDS will be created"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the RDS subnet group"
  type        = list(string)
}

variable "eks_security_group_id" {
  description = "Security group ID of EKS nodes — allowed to connect to RDS on port 5432"
  type        = string
}

variable "db_name" {
  description = "Name of the initial database to create"
  type        = string
  default     = "biggshots"
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  default     = "bsmadmin"
}

variable "db_password" {
  description = "Master password for the RDS instance — passed from secrets.tfvars, never hardcoded"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "postgres_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15.4"
}
