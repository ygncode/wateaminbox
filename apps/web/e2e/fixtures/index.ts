export {
  test,
  expect,
  TEST_USER,
  loginViaUI,
  clearAuthState,
  setAuthTokens,
} from "./auth.fixture"

// Re-export whatsapp fixture helpers and mock data
// Note: whatsapp.fixture.ts defines its own `test` with WhatsApp-specific fixtures
// Import directly from './whatsapp.fixture' when you need whatsappConnectedPage or whatsappDisconnectedPage
export {
  MOCK_CONNECTION,
  MOCK_QR_CODE,
  mockQRCodeGeneration,
  mockConnectionSuccess,
  mockMaxConnectionsError,
  mockConnectionError,
  mockDisconnect,
} from "./whatsapp.fixture"
