# ── DB Subnet Group ───────────────────────────────────────────────────────────
# Tells RDS which subnets it can place instances in.
# We use private subnets only — RDS should never be in a public subnet.
# PRODUCTION NOTE: This is correct — always use private subnets for RDS.
resource "aws_db_subnet_group" "main" {
  name        = "${var.project}-${var.environment}-db-subnet-group"
  subnet_ids  = var.private_subnet_ids
  description = "Subnet group for ${var.project} ${var.environment} RDS instance"

  tags = {
    Name        = "${var.project}-${var.environment}-db-subnet-group"
    Environment = var.environment
    Project     = var.project
  }
}

# ── RDS Security Group ────────────────────────────────────────────────────────
# Only allows inbound PostgreSQL traffic (port 5432) from EKS worker nodes.
# No public inbound access — RDS is fully private.
#
# PRODUCTION NOTE: This is the correct pattern. In production you might also
# allow inbound from a bastion host security group for admin access:
#
# ingress {
#   description     = "PostgreSQL from bastion"
#   from_port       = 5432
#   to_port         = 5432
#   protocol        = "tcp"
#   security_groups = [var.bastion_security_group_id]
# }
resource "aws_security_group" "rds" {
  name        = "${var.project}-${var.environment}-rds-sg"
  description = "Security group for RDS — allows PostgreSQL from EKS nodes only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from EKS worker nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.eks_security_group_id]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-${var.environment}-rds-sg"
    Environment = var.environment
  }
}

# ── RDS PostgreSQL Instance ───────────────────────────────────────────────────
# Managed PostgreSQL database. AWS handles backups, patching, and failover.
#
# storage_encrypted = true: encrypts data at rest using AWS KMS.
# PRODUCTION NOTE: Always encrypt at rest. We're using the default KMS key here.
# In production, use a customer-managed KMS key (CMK) for more control:
# kms_key_id = aws_kms_key.rds.arn
#
# skip_final_snapshot = true: no snapshot taken when the DB is destroyed.
# PRODUCTION NOTE: Always set skip_final_snapshot = false in production and
# set final_snapshot_identifier = "${var.project}-final-snapshot-${timestamp()}"
# This ensures you have a recovery point before any destructive operation.
#
# deletion_protection = false: allows Terraform to destroy the DB.
# PRODUCTION NOTE: Set deletion_protection = true in production.
# You'd need to manually disable it before running terraform destroy.
#
# multi_az = false: single AZ, no automatic failover.
# PRODUCTION NOTE: Set multi_az = true for production. AWS automatically
# provisions a standby replica in a different AZ and fails over in ~60 seconds
# if the primary becomes unavailable. Roughly doubles the RDS cost.
#
# backup_retention_period = 0: no automated backups.
# PRODUCTION NOTE: Set to at least 7 (days) in production. AWS will take
# daily snapshots and retain them for that many days, enabling point-in-time
# recovery (PITR) to any second within the retention window.
#
# Password handling: passed via secrets.tfvars, marked sensitive = true in
# variables.tf so it's redacted from Terraform plan/apply output.
# PRODUCTION NOTE: Use AWS Secrets Manager instead:
#
# data "aws_secretsmanager_secret_version" "db_password" {
#   secret_id = "prod/biggshots/db_password"
# }
# password = data.aws_secretsmanager_secret_version.db_password.secret_string
#
# This way the password is never in your .tfvars files or local disk at all.
resource "aws_db_instance" "main" {
  identifier        = "${var.project}-${var.environment}-postgres"
  engine            = "postgres"
  engine_version    = var.postgres_version
  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  publicly_accessible     = false
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 0
  multi_az                = false

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}
