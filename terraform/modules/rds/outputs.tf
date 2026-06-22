output "db_endpoint" {
  description = "RDS instance endpoint (host:port) — used by application services to connect"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "db_host" {
  description = "RDS hostname only (without port) — for use in Kubernetes secrets"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "db_port" {
  description = "RDS port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Name of the database created on the RDS instance"
  value       = aws_db_instance.main.db_name
}

output "db_security_group_id" {
  description = "Security group ID of the RDS instance"
  value       = aws_security_group.rds.id
}
