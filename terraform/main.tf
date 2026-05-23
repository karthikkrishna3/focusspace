# terraform/main.tf
# FocusSpace — AWS Free Tier deployment
# Resources: VPC, EC2 t2.micro, Security Group, Elastic IP
#
# Usage:
#   cd terraform
#   terraform init
#   terraform apply -var="key_name=YOUR_KEY_PAIR_NAME"

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ── Variables ──────────────────────────────────────────────────────────────────
variable "region"   { default = "us-east-1" }
variable "key_name" { description = "EC2 Key Pair name for SSH access" }
variable "app_port" { default = 4000 }

provider "aws" {
  region = var.region
}

# ── VPC ────────────────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "focusspace-vpc" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "focusspace-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "${var.region}a"
  tags = { Name = "focusspace-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = { Name = "focusspace-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ── Security Group ─────────────────────────────────────────────────────────────
resource "aws_security_group" "app" {
  name        = "focusspace-sg"
  description = "FocusSpace app traffic"
  vpc_id      = aws_vpc.main.id

  # SSH
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "SSH"
  }

  # HTTP (for NGINX reverse proxy / Let's Encrypt)
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP"
  }

  # HTTPS
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  # App port (direct access during dev)
  ingress {
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Node.js app"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "focusspace-sg" }
}

# ── EC2 t2.micro (free tier) ───────────────────────────────────────────────────
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t2.micro"   # free tier eligible
  key_name               = var.key_name
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]

  user_data = <<-USERDATA
    #!/bin/bash
    # Amazon Linux 2023 bootstrap
    dnf update -y
    dnf install -y git nodejs npm nginx

    # Node 20 via nvm
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="/root/.nvm"
    source "$NVM_DIR/nvm.sh"
    nvm install 20
    nvm use 20
    npm i -g pm2

    # Clone your repo (replace with actual repo URL)
    git clone https://github.com/YOUR_USER/focusspace.git /opt/focusspace
    cd /opt/focusspace
    npm ci

    # Write production .env
    cat > /opt/focusspace/.env << 'ENVEOF'
    PORT=4000
    NODE_ENV=production
    CORS_ORIGIN=*
    ENVEOF

    # Build React frontend
    cd client && npm ci && npm run build && cd ..

    # Start with PM2
    pm2 start server/index.js --name focusspace --env production
    pm2 startup systemd -u root --hp /root
    pm2 save

    # NGINX reverse proxy config
    cat > /etc/nginx/conf.d/focusspace.conf << 'NGINXEOF'
    server {
      listen 80;
      server_name _;

      location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
      }

      # WebSocket upgrade
      location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
      }
    }
    NGINXEOF

    systemctl enable nginx
    systemctl start nginx
  USERDATA

  root_block_device {
    volume_size = 8   # 8 GB — free tier covers up to 30 GB
    volume_type = "gp3"
  }

  tags = { Name = "focusspace-app" }
}

# ── Elastic IP ────────────────────────────────────────────────────────────────
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "focusspace-eip" }
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "public_ip" {
  value       = aws_eip.app.public_ip
  description = "Elastic IP — point your domain A record here"
}

output "ssh_command" {
  value = "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_eip.app.public_ip}"
}

output "app_url" {
  value = "http://${aws_eip.app.public_ip}"
}
