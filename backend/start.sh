#!/bin/sh
echo "🔄 Running database migration..."
npx prisma db push --accept-data-loss
echo "🚀 Starting GenzTech Backend..."
node src/server.js
