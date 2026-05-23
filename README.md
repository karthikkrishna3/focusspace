<<<<<<< HEAD
# focusspace
=======
# 🪐 FocusSpace — Virtual Co-working Rooms

> Work together. Stay in flow.

Real-time virtual co-working rooms with shared countdown timers, lofi music, live chat, and presence — built with React, Node.js, and WebSockets, deployed on AWS free tier.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (React + Vite)                              │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ UI / CSS │  │ WebAudio │  │  useCoworkWS hook  │ │
│  └──────────┘  └──────────┘  └────────┬───────────┘ │
└───────────────────────────────────────┼─────────────┘
                    WebSocket (ws://)   │  HTTP (REST)
┌───────────────────────────────────────┼─────────────┐
│  Node.js / Express (EC2 t2.micro)     │              │
│  ┌─────────────────┐  ┌──────────────┴──────────┐   │
│  │  WS Server      │  │  REST API               │   │
│  │  ws.js          │  │  /api/rooms             │   │
│  │  1s timer tick  │  │  /api/health            │   │
│  └────────┬────────┘  └─────────────────────────┘   │
│           │                                          │
│  ┌────────▼────────────────────────────────────────┐ │
│  │  RoomStore (in-memory, Redis-ready)             │ │
│  │  rooms / users / messages / timer state         │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         │ Terraform
┌────────▼──────────────────────┐
│  AWS Free Tier                │
│  VPC → Subnet → EC2 t2.micro  │
│  Security Group → Elastic IP  │
│  NGINX (reverse proxy + WSS)  │
└───────────────────────────────┘
```

---

## Quick Start (local dev)

### Prerequisites
- Node.js 18+
- npm 9+

### 1 — Clone & install

```bash
git clone https://github.com/YOUR_USER/focusspace.git
cd focusspace

# Backend
npm install

# Frontend
cd client && npm install && cd ..
```

### 2 — Run backend

```bash
# Terminal 1
npm run dev
# → REST  http://localhost:4000/api
# → WS    ws://localhost:4000
```

### 3 — Run frontend

```bash
# Terminal 2
cd client && npm run dev
# → http://localhost:5173
```

---

## WebSocket Protocol

All frames are JSON.

### Client → Server

| type    | payload                          | description              |
|---------|----------------------------------|--------------------------|
| `join`  | `{ roomId, name, avatarId }`     | Join a room              |
| `leave` | —                                | Leave current room       |
| `chat`  | `{ text }`                       | Send a chat message      |
| `timer` | `{ action: start\|pause\|reset }` | Control shared timer     |
| `ping`  | —                                | Heartbeat                |

### Server → Client

| type          | payload                                | description              |
|---------------|----------------------------------------|--------------------------|
| `welcome`     | `{ room, users, messages }`            | Initial room state       |
| `user_join`   | `{ user, memberCount }`                | Someone joined           |
| `user_leave`  | `{ name, memberCount }`                | Someone left             |
| `chat`        | `{ message }`                          | New chat message         |
| `timer_sync`  | `{ timerLeft, timerRunning }`          | Timer state update       |
| `timer_done`  | —                                      | Session complete         |
| `error`       | `{ message }`                          | Server error             |
| `pong`        | —                                      | Heartbeat reply          |

---

## REST API

```
GET  /api/health          — Server health + metrics
GET  /api/rooms           — List all rooms
GET  /api/rooms/:id       — Single room detail + messages + users
```

---

## Deploy to AWS Free Tier

### Prerequisites
- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.7
- [AWS CLI](https://aws.amazon.com/cli/) configured (`aws configure`)
- EC2 Key Pair created in AWS Console

### 1 — Provision infrastructure

```bash
cd terraform
terraform init
terraform apply -var="key_name=YOUR_KEY_PAIR_NAME"
# outputs: public_ip, ssh_command, app_url
```

### 2 — Push your code

Update `user_data` in `terraform/main.tf` with your actual GitHub repo URL, then:

```bash
terraform taint aws_instance.app   # force re-provision
terraform apply -var="key_name=YOUR_KEY_PAIR_NAME"
```

### 3 — (Optional) Add a domain + HTTPS

```bash
# SSH into the instance
ssh -i ~/.ssh/YOUR_KEY.pem ec2-user@PUBLIC_IP

# Install certbot and get a free TLS cert
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### 4 — CI/CD (GitHub Actions)

Add these secrets to your GitHub repo:
- `EC2_HOST` — your Elastic IP
- `EC2_SSH_KEY` — contents of your `.pem` file
- `VITE_WS_URL` — `wss://yourdomain.com` (or `ws://IP:4000`)

Push to `main` — the pipeline tests, builds, and deploys automatically.

---

## Scaling beyond free tier

When you outgrow a single t2.micro:

| Layer         | Upgrade path                                                |
|---------------|-------------------------------------------------------------|
| Compute       | ECS Fargate with multiple tasks / EKS                       |
| Timer sync    | Replace `store.js` in-memory with **ElastiCache Redis**     |
| WebSocket     | **API Gateway WebSocket API** + Lambda handlers             |
| Messages      | **DynamoDB** table per room (TTL = 24 h)                    |
| Static assets | **S3 + CloudFront** CDN                                     |
| Music files   | S3 pre-signed URLs for real lofi MP3s                       |

---

## Local test

```bash
# Start server first, then:
npm test
```

Runs REST + WebSocket smoke tests and prints a pass/fail summary.

---

## Project structure

```
focusspace/
├── server/
│   ├── index.js          — HTTP server entry point
│   ├── app.js            — Express app + middleware
│   ├── ws.js             — WebSocket server + message router
│   ├── store.js          — In-memory room/user/timer state
│   └── routes/
│       ├── rooms.js      — REST room endpoints
│       └── health.js     — Health check
├── client/
│   └── src/
│       ├── App.jsx       — Full React UI
│       └── useCoworkWS.js — WS client hook
├── scripts/
│   └── test-ws.js        — Integration test runner
├── terraform/
│   └── main.tf           — AWS free-tier infra
├── .github/workflows/
│   └── deploy.yml        — CI/CD pipeline
├── Dockerfile            — Multi-stage container build
├── .env.example
└── README.md
```
>>>>>>> bd9813c (feat: FocusSpace initial commit)
