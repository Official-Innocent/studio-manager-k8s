# ── Core ──────────────────────────────────────────────────────────────────────
aws_region  = "eu-west-2"
project     = "biggshots"
environment = "prod"

# ── Networking ────────────────────────────────────────────────────────────────
vpc_cidr             = "10.0.0.0/16"
public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]

# ── EKS ───────────────────────────────────────────────────────────────────────
cluster_version    = "1.29"
node_instance_type = "t3.medium"
node_desired_size  = 2
node_min_size      = 1
node_max_size      = 3

# ── RDS ───────────────────────────────────────────────────────────────────────
db_name              = "biggshots"
db_username          = "bsmadmin"
db_instance_class    = "db.t3.micro"
db_allocated_storage = 20
postgres_version     = "15.4"
# db_password is intentionally absent — set in secrets.tfvars (gitignored)
