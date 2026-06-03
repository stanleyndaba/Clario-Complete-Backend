@echo off
cd /d "c:\Users\Student\Contacts\Clario-Complete-Backend\Integrations-backend"
npx ts-node --project tsconfig.json src/scripts/spapi-keepalive-cron.ts >> spapi-keepalive.log 2>&1
