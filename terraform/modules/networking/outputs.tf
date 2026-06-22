output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets (for ALB/load balancers)"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (for EKS nodes and RDS)"
  value       = aws_subnet.private[*].id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC (used by security groups in other modules)"
  value       = aws_vpc.main.cidr_block
}

output "nat_gateway_ip" {
  description = "Public IP of the NAT Gateway (useful for whitelisting outbound traffic)"
  value       = aws_eip.nat.public_ip
}
