terraform {
  backend "s3" {
    bucket         = "bsm-terraform-state-210452150981"
    key            = "prod/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "bsm-terraform-locks"
    encrypt        = true
  }
}
