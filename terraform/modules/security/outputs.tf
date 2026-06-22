output "guardduty_detector_id" {
  description = "GuardDuty detector ID — use to verify detector status in AWS console"
  value       = aws_guardduty_detector.main.id
}

output "cloudtrail_arn" {
  description = "CloudTrail ARN — reference in audit and compliance documentation"
  value       = aws_cloudtrail.main.arn
}

output "cloudtrail_bucket" {
  description = "S3 bucket storing CloudTrail logs"
  value       = aws_s3_bucket.cloudtrail.id
}

output "flow_logs_log_group" {
  description = "CloudWatch Log Group name for VPC Flow Logs — query in CloudWatch Logs Insights"
  value       = aws_cloudwatch_log_group.flow_logs.name
}

output "security_hub_id" {
  description = "Security Hub account ID — confirms Security Hub is enabled"
  value       = aws_securityhub_account.main.id
}

output "access_analyzer_name" {
  description = "IAM Access Analyzer name"
  value       = aws_accessanalyzer_analyzer.main.analyzer_name
}
