# ── GuardDuty ─────────────────────────────────────────────────────────────────
# AWS threat detection service. Once enabled, it automatically starts consuming:
# - VPC Flow Logs (network-level threat detection)
# - CloudTrail (API-level threat detection)
# - DNS logs (detects C2 communication, crypto mining, data exfiltration)
#
# GuardDuty uses ML models and AWS threat intelligence feeds to identify:
# - Compromised EC2 instances (unusual outbound traffic, port scanning)
# - Compromised credentials (API calls from unusual locations/times)
# - Cryptocurrency mining (GPU usage spikes, known mining pool IPs)
# - Container threats (EKS audit log analysis, unusual pod behaviour)
#
# COST: Free for 30 days on new accounts, then ~$1-4/month for our traffic volume.
# PRODUCTION NOTE: This is standard — enable GuardDuty on every AWS account
# from day one. The cost is negligible compared to the detection value.
# In a multi-account setup, use GuardDuty delegated admin in AWS Organizations
# so one account manages findings across all accounts centrally.
resource "aws_guardduty_detector" "main" {
  enable = true

  datasources {
    s3_logs {
      enable = true
    }
    kubernetes {
      audit_logs {
        enable = true
      }
    }
    malware_protection {
      scan_ec2_instance_with_findings {
        ebs_volumes {
          enable = true
        }
      }
    }
  }

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

# ── CloudTrail ────────────────────────────────────────────────────────────────
# Records every AWS API call in the account — who did what, when, from where.
# Essential for: security incident investigation, compliance auditing,
# change tracking, and feeding GuardDuty with API-level threat signals.
#
# Without CloudTrail, if credentials are compromised you cannot determine:
# - What resources were accessed or modified
# - Which IAM user/role made the calls
# - Whether data was exfiltrated via S3 GetObject calls
#
# is_multi_region_trail = true: captures events in ALL regions, not just eu-west-2.
# This matters because attackers often pivot to other regions to create resources
# outside your normal monitoring view.
#
# enable_log_file_validation = true: CloudTrail signs each log file with SHA-256.
# If a log file is tampered with, the validation will fail — important for
# compliance (PCI DSS, SOC2) and forensic integrity.
#
# PRODUCTION NOTE: This is standard practice. Always enable CloudTrail from
# day one. In production, also enable CloudWatch Logs integration so you can
# set metric filters and alarms on specific API calls (e.g. alert on
# DeleteBucket, StopLogging, or any root account API call).
resource "aws_s3_bucket" "cloudtrail" {
  bucket        = "${var.project}-cloudtrail-${var.environment}-${var.account_id}"
  force_destroy = true

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail" {
  bucket                  = aws_s3_bucket.cloudtrail.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CloudTrail requires a bucket policy explicitly allowing it to write logs.
# Without this policy, CloudTrail cannot deliver logs and will fail to create.
# The policy follows the principle of least privilege — only CloudTrail service
# can write to this bucket, and only for this specific account.
resource "aws_s3_bucket_policy" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSCloudTrailAclCheck"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = "arn:aws:s3:::${aws_s3_bucket.cloudtrail.id}"
      },
      {
        Sid    = "AWSCloudTrailWrite"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "arn:aws:s3:::${aws_s3_bucket.cloudtrail.id}/AWSLogs/${var.account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }
    ]
  })
}

resource "aws_cloudtrail" "main" {
  name                          = "${var.project}-${var.environment}-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true

  depends_on = [aws_s3_bucket_policy.cloudtrail]

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

# ── VPC Flow Logs ─────────────────────────────────────────────────────────────
# Captures metadata about all IP traffic flowing through the VPC.
# Each flow log record contains: source IP, dest IP, port, protocol,
# bytes transferred, and whether traffic was ACCEPT or REJECT.
#
# Use cases:
# - Detect port scanning attempts against your instances
# - Identify unexpected traffic patterns (e.g. pod reaching external IP on port 4444)
# - Debug security group rules (REJECT records show what's being blocked)
# - GuardDuty automatically analyses flow logs for threat signals
#
# traffic_type = "ALL": captures both accepted and rejected traffic.
# PRODUCTION NOTE: "ALL" generates more data (CloudWatch Logs cost) but gives
# complete visibility. Some teams use "REJECT" only to reduce cost, but this
# misses the ability to detect accepted connections to suspicious destinations.
# In production, consider sending flow logs to S3 instead of CloudWatch for
# lower cost, then querying with Athena for ad-hoc investigation.
resource "aws_iam_role" "flow_logs" {
  name = "${var.project}-${var.environment}-flow-logs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "flow_logs" {
  name = "${var.project}-${var.environment}-flow-logs-policy"
  role = aws_iam_role.flow_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ]
      Resource = "*"
    }]
  })
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/aws/vpc/flow-logs/${var.project}-${var.environment}"
  retention_in_days = 30

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

resource "aws_flow_log" "main" {
  vpc_id          = var.vpc_id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flow_logs.arn
  log_destination = aws_cloudwatch_log_group.flow_logs.arn

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

# ── Security Hub ──────────────────────────────────────────────────────────────
# Aggregates security findings from GuardDuty, ECR image scanning, IAM
# Access Analyzer, and AWS Config into a single dashboard with a security score.
#
# Standards enabled:
# - AWS Foundational Security Best Practices: 200+ automated checks covering
#   IAM, S3, RDS, EC2, EKS, CloudTrail, GuardDuty configuration
# - CIS AWS Foundations Benchmark: Industry-standard security baseline,
#   referenced in job descriptions for DevSecOps roles
#
# PRODUCTION NOTE: Security Hub is the single pane of glass for security posture.
# In a multi-account setup (Organizations), enable Security Hub in a dedicated
# security account and aggregate findings from all member accounts.
# Integrate with PagerDuty or Slack via EventBridge for real-time alerting
# on HIGH/CRITICAL findings.
#
# COST: Free for 30 days, then ~$0.001 per finding check per account per month.
# For our scale, effectively free beyond the trial period.
resource "aws_securityhub_account" "main" {}

resource "aws_securityhub_standards_subscription" "aws_best_practices" {
  standards_arn = "arn:aws:securityhub:${var.aws_region}::standards/aws-foundational-security-best-practices/v/1.0.0"
  depends_on    = [aws_securityhub_account.main]
}

resource "aws_securityhub_standards_subscription" "cis" {
  standards_arn = "arn:aws:securityhub:${var.aws_region}::standards/cis-aws-foundations-benchmark/v/1.2.0"
  depends_on    = [aws_securityhub_account.main]
}

# ── IAM Access Analyzer ───────────────────────────────────────────────────────
# Analyses resource-based policies (S3 bucket policies, IAM role trust policies,
# KMS key policies) and alerts when resources are accessible from outside
# your AWS account or organisation.
#
# Example: if someone accidentally makes an S3 bucket publicly accessible,
# IAM Access Analyzer generates a finding within minutes.
#
# PRODUCTION NOTE: Always enable Access Analyzer. It's free and has caught
# real misconfigurations that would otherwise go unnoticed for weeks.
# In an Organizations setup, create an analyzer at the organization level
# so it covers all accounts, not just the current one.
resource "aws_accessanalyzer_analyzer" "main" {
  analyzer_name = "${var.project}-${var.environment}-analyzer"
  type          = "ACCOUNT"

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}
