#!/bin/bash
# CityZen Database Reset Script
# Drops all tables and re-creates them from the Prisma schema.
#
# Prerequisites:
#   1. Make sure DIRECT_URL is set in server/.env (the direct Supabase connection, port 5432, no pgbouncer)
#      Example: DIRECT_URL="postgresql://postgres.cquceoasbbqlssanvaxv:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
#   2. Run from the server directory: cd server && bash scripts/db-reset.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$SERVER_DIR"

echo "=== CityZen Database Reset ==="
echo ""

# Check for DIRECT_URL
if ! grep -q "DIRECT_URL" .env 2>/dev/null; then
  echo "❌ DIRECT_URL is not set in server/.env"
  echo ""
  echo "Add your direct Supabase connection URL (port 5432, NOT the pgbouncer URL):"
  echo "  DIRECT_URL=\"postgresql://postgres.YOUR_PROJECT:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres\""
  echo ""
  exit 1
fi

echo "Step 1: Generating Prisma client..."
npx prisma generate

echo ""
echo "Step 2: Pushing schema to database (drops & recreates all tables)..."
npx prisma db push --force-reset

echo ""
echo "Step 3: Generating Prisma client (post-push)..."
npx prisma generate

echo ""
echo "✅ Database reset complete! All tables created from schema.prisma"
echo ""
echo "Tables created:"
echo "  • Player"
echo "  • World"
echo "  • City"
echo "  • Building"
echo "  • GameMessage"
echo "  • MessageTemplate"
