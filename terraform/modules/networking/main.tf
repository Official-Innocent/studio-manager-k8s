# ── VPC ───────────────────────────────────────────────────────────────────────
# The VPC is the isolated network boundary for all our resources.
# enable_dns_hostnames and enable_dns_support are required for EKS to work correctly.
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.project}-${var.environment}-vpc"
    Environment = var.environment
    Project     = var.project
  }
}

# ── Public Subnets ────────────────────────────────────────────────────────────
# Public subnets host internet-facing resources (ALB/load balancers).
# map_public_ip_on_launch = true so instances here get public IPs automatically.
# The kubernetes.io/role/elb tag tells the AWS Load Balancer Controller
# which subnets to place public-facing load balancers in.
resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                     = "${var.project}-${var.environment}-public-${count.index + 1}"
    Environment              = var.environment
    "kubernetes.io/role/elb" = "1"
  }
}

# ── Private Subnets ───────────────────────────────────────────────────────────
# Private subnets host EKS worker nodes and RDS.
# No direct internet access — traffic routes via NAT Gateway.
# The kubernetes.io/role/internal-elb tag tells the AWS Load Balancer Controller
# to place internal (private) load balancers here.
resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name                              = "${var.project}-${var.environment}-private-${count.index + 1}"
    Environment                       = var.environment
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# ── Internet Gateway ──────────────────────────────────────────────────────────
# Allows resources in public subnets to communicate with the internet.
# One IGW per VPC — it's regional and highly available by default.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "${var.project}-${var.environment}-igw"
    Environment = var.environment
  }
}

# ── Elastic IP for NAT Gateway ────────────────────────────────────────────────
# NAT Gateway requires a static public IP (EIP).
# PRODUCTION NOTE: In production, use one NAT Gateway per AZ for fault tolerance.
# We're using one here to minimise cost (~$32/month each).
resource "aws_eip" "nat" {
  domain     = "vpc"
  depends_on = [aws_internet_gateway.main]

  tags = {
    Name        = "${var.project}-${var.environment}-nat-eip"
    Environment = var.environment
  }
}

# ── NAT Gateway ───────────────────────────────────────────────────────────────
# Allows private subnet resources (EKS nodes, RDS) to initiate outbound
# internet connections (e.g. pull container images, OS updates) without
# being directly reachable from the internet.
# Must be placed in a PUBLIC subnet — it routes outbound traffic from private subnets.
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]

  tags = {
    Name        = "${var.project}-${var.environment}-nat"
    Environment = var.environment
  }
}

# ── Route Tables ──────────────────────────────────────────────────────────────
# Public route table: default route goes to Internet Gateway
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name        = "${var.project}-${var.environment}-public-rt"
    Environment = var.environment
  }
}

# Private route table: default route goes to NAT Gateway
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = {
    Name        = "${var.project}-${var.environment}-private-rt"
    Environment = var.environment
  }
}

# ── Route Table Associations ──────────────────────────────────────────────────
# Associate each subnet with its route table.
# Without this, subnets use the VPC's default route table which has no internet route.
resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
