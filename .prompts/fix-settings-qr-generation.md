# Task: Fix Settings QR Code Generation

## Objective
Use Puppeteer MCP to test and fix issues with the WhatsApp device linking QR code generation in settings.

## Type
Bug Fix

## Scope
- **Frontend**: `apps/web` - Settings page components, WhatsApp linking UI
- **Backend**: `apps/api` - WhatsApp routes (`/api/whatsapp`)
- **Services**: `services/whatsapp` - Go WhatsApp client handling QR generation
- **Patterns**: Follow existing implementations in both backend and frontend

## Requirements
- [ ] QR code displays correctly on the settings/device linking page
- [ ] QR code is properly rendered and visible
- [ ] No console errors during QR generation
- [ ] QR code refreshes appropriately if expired

## Verification
1. **Use Puppeteer MCP** to automate testing:
   - Launch browser and navigate to the application
   - Login with test credentials
   - Navigate to settings/WhatsApp device linking page
   - Verify QR code element is present and visible
   - Take screenshots for visual verification
   - Check for any JavaScript errors in console

2. **Puppeteer test steps**:
   ```
   - puppeteer_launch (headless: false for debugging)
   - puppeteer_new_page
   - puppeteer_navigate to login page
   - puppeteer_type credentials
   - puppeteer_click login button
   - puppeteer_navigate to settings/whatsapp linking
   - puppeteer_wait_for_selector for QR code element
   - puppeteer_screenshot to capture QR display
   - puppeteer_evaluate to check for errors
   ```

## Additional Context
- The application runs on:
  - Frontend: `http://localhost:5173`
  - Backend API: `http://localhost:3001`
- Communication flow: Browser <-> Hono API <-> NATS <-> Go WhatsApp service
- QR generation involves WebSocket communication for real-time updates
- Start services with `bun run dev` before testing
