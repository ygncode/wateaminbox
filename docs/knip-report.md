Unused files (20)
apps/web/src/components/auth/PermissionGuard.tsx     
apps/web/src/components/chat/index.ts                
apps/web/src/components/chat/SelectionToolbar.tsx    
apps/web/src/components/dashboard/index.ts           
apps/web/src/components/groups/GroupInfoPanel.tsx    
apps/web/src/components/groups/index.ts              
apps/web/src/components/layout/index.ts              
apps/web/src/components/search/index.ts              
apps/web/src/components/search/SearchPanel.tsx       
apps/web/src/components/status/index.ts              
apps/web/src/components/status/PostStatusDialog.tsx  
apps/web/src/components/status/StatusList.tsx        
apps/web/src/components/status/StatusViewer.tsx      
apps/web/src/hooks/index.ts                          
apps/web/src/hooks/useConversationState.ts           
apps/web/src/hooks/usePermissions.ts                 
apps/web/src/hooks/useStatus.ts                      
apps/web/src/hooks/useSwipeGesture.ts                
apps/web/src/hooks/useWebSocket.ts                   
packages/database/src/types/database.ts              
Unused dependencies (3)
@hono/node-server     apps/api/package.json:17:6
@whatsapp-web/shared  apps/api/package.json:20:6
@whatsapp-web/ui      apps/web/package.json:30:6
Unused devDependencies (6)
prettier-plugin-astro        apps/marketing/package.json:23:6
eslint-plugin-react-hooks    apps/web/package.json:50:6      
eslint-plugin-react-refresh  apps/web/package.json:51:6      
react-scan                   apps/web/package.json:53:6      
@types/react-dom             packages/ui/package.json:27:6   
react-dom                    packages/ui/package.json:29:6   
Unlisted dependencies (15)
ioredis  apps/api/src/lib/rate-limit-store.ts:270:34             
kysely   apps/api/src/middleware/tenant.ts:13:30                 
kysely   apps/api/src/services/analytics.service.ts:1:22         
kysely   apps/api/src/services/catalog-sync.service.ts:1:30      
kysely   apps/api/src/services/company.service.ts:1:22           
kysely   apps/api/src/services/contact.service.ts:1:30           
kysely   apps/api/src/services/conversation-state.service.ts:1:30
kysely   apps/api/src/services/export.service.ts:1:22            
kysely   apps/api/src/services/import.service.ts:2:43            
kysely   apps/api/src/services/label-sync.service.ts:1:30        
kysely   apps/api/src/services/message-cleanup.service.ts:2:22   
kysely   apps/api/src/services/search.service.ts:1:46            
pg       apps/api/src/services/tenant.service.ts:1:28            
kysely   apps/api/src/services/tenant.service.ts:2:47            
kysely   apps/api/src/services/whatsapp.service.ts:1:30          
Unlisted binaries (4)
eslint    apps/api/package.json             
prettier  apps/api/package.json             
go        services/orchestrator/package.json
go        services/whatsapp/package.json    
Unresolved imports (1)
bun-types  apps/api/tsconfig.json
Unused exports (104)
isValidCleanupConfig                                    function  apps/api/src/config/cleanup.config.ts:65:17           
DEFAULT_CLEANUP_CONFIG                                            apps/api/src/config/cleanup.config.ts:91:14           
isValidRateLimitConfig                                  function  apps/api/src/config/rate-limit.config.ts:268:17       
decodeToken                                             function  apps/api/src/lib/jwt.ts:144:17                        
subscribeToCompanyEvents                                function  apps/api/src/lib/nats.ts:840:23                       
subscribeToConnectionEvents                             function  apps/api/src/lib/nats.ts:851:23                       
isNatsConnected                                         function  apps/api/src/lib/nats.ts:889:17                       
request                                                 function  apps/api/src/lib/nats.ts:896:23                       
downloadMediaFromUrl                                    function  apps/api/src/lib/storage.ts:136:23                    
optionalAuthMiddleware                                            apps/api/src/middleware/auth.ts:104:14                
requireEmailVerification                                          apps/api/src/middleware/auth.ts:136:14                
requireAdmin                                            function  apps/api/src/middleware/tenant.ts:188:17              
requireOwner                                            function  apps/api/src/middleware/tenant.ts:203:17              
requireAllPermissions                                   function  apps/api/src/middleware/tenant.ts:234:17              
requireAnyPermission                                    function  apps/api/src/middleware/tenant.ts:256:17              
getConnectionCount                                      function  apps/api/src/routes/ws.ts:453:17                      
getTotalConnectionCount                                 function  apps/api/src/routes/ws.ts:460:17                      
getProductByProductId                                   function  apps/api/src/services/catalog-sync.service.ts:179:23  
syncCatalogsFromWhatsApp                                function  apps/api/src/services/catalog-sync.service.ts:217:23  
syncCatalogProductsFromWhats…                           function  apps/api/src/services/catalog-sync.service.ts:307:23  
syncLabelsFromWhatsApp                                  function  apps/api/src/services/label-sync.service.ts:114:23    
indexContact                   meilisearchService       function  apps/api/src/services/meilisearch.service.ts:218:23   
deleteMessage                  meilisearchService       function  apps/api/src/services/meilisearch.service.ts:250:23   
deleteContact                  meilisearchService       function  apps/api/src/services/meilisearch.service.ts:265:23   
deleteCompanyIndexes           meilisearchService       function  apps/api/src/services/meilisearch.service.ts:444:23   
isMessageHandlerInitialized                             function  apps/api/src/services/message-handler.ts:931:17       
deleteOldNotifications         notificationHistorySer…  function  …i/src/services/notification-history.service.ts:276:23
getActiveConnections           whatsappService          function  apps/api/src/services/whatsapp.service.ts:523:23      
MainContentHeader                                       function  apps/web/src/components/layout/main-content.tsx:27:17 
MessageArea                                             function  apps/web/src/components/layout/main-content.tsx:53:17 
MessageInputArea                                        function  apps/web/src/components/layout/main-content.tsx:75:17 
EmptyState                                              function  apps/web/src/components/layout/main-content.tsx:102:17
MobileHeader                                            function  apps/web/src/components/layout/MobileLayout.tsx:187:17
MobileActionButton                                      function  apps/web/src/components/layout/MobileLayout.tsx:334:17
SidebarHeader                                           function  apps/web/src/components/layout/sidebar.tsx:31:17      
SidebarSearch                                           function  apps/web/src/components/layout/sidebar.tsx:57:17      
SidebarContent                                          function  apps/web/src/components/layout/sidebar.tsx:77:17      
useIsAdmin                                              function  apps/web/src/contexts/auth-context.tsx:327:17         
useShortcutsEnabled                                     function  …/web/src/contexts/KeyboardShortcutsContext.tsx:333:17
useRegisteredShortcuts                                  function  …/web/src/contexts/KeyboardShortcutsContext.tsx:341:17
useRegisterShortcutAction                               function  …/web/src/contexts/KeyboardShortcutsContext.tsx:349:17
useResolutionTrend                                      function  apps/web/src/hooks/useAnalytics.ts:334:17             
getAuditExportUrl                                       function  apps/web/src/hooks/useAudit.ts:113:17                 
getActionCategory                                       function  apps/web/src/hooks/useAudit.ts:137:17                 
useWhatsAppCatalog                                      function  apps/web/src/hooks/useCatalogs.ts:52:17               
useUpdateProductVisibility                              function  apps/web/src/hooks/useCatalogs.ts:135:17              
useGroupsAsChats                                        function  apps/web/src/hooks/useChats.ts:192:17                 
useChat                                                 function  apps/web/src/hooks/useChats.ts:280:17                 
useBulkExport                                           function  apps/web/src/hooks/useExport.ts:185:17                
useGroup                                                function  apps/web/src/hooks/useGroups.ts:113:17                
useUpdateGroup                                          function  apps/web/src/hooks/useGroups.ts:129:17                
useGroupAdminStatus                                     function  apps/web/src/hooks/useGroups.ts:179:17                
usePromoteParticipant                                   function  apps/web/src/hooks/useGroups.ts:197:17                
useDemoteParticipant                                    function  apps/web/src/hooks/useGroups.ts:240:17                
useRemoveParticipant                                    function  apps/web/src/hooks/useGroups.ts:283:17                
useUpdateGroupSettings                                  function  apps/web/src/hooks/useGroups.ts:327:17                
useInfiniteMessagesUtils                                function  apps/web/src/hooks/useInfiniteMessages.ts:63:17       
useKeyboardShortcut                                     function  apps/web/src/hooks/useKeyboardShortcuts.ts:282:17     
useApplyLabelToContact                                  function  apps/web/src/hooks/useLabels.ts:125:17                
useRemoveLabelFromContact                               function  apps/web/src/hooks/useLabels.ts:147:17                
useIsSmallMobile                                        function  apps/web/src/hooks/useMediaQuery.ts:74:17             
useIsTouchDevice                                        function  apps/web/src/hooks/useMediaQuery.ts:82:17             
useIsLandscape                                          function  apps/web/src/hooks/useMediaQuery.ts:90:17             
useBreakpoints                                          function  apps/web/src/hooks/useMediaQuery.ts:98:17             
useMessages                                             function  apps/web/src/hooks/useMessages.ts:15:17               
useMessage                                              function  apps/web/src/hooks/useMessages.ts:25:17               
useUpdateMessage                                        function  apps/web/src/hooks/useMessages.ts:115:17              
useQuickReplySearch                                     function  apps/web/src/hooks/useQuickReplies.ts:139:17          
useGlobalSearch                                         function  apps/web/src/hooks/useSearch.ts:63:17                 
useMessageSearch                                        function  apps/web/src/hooks/useSearch.ts:95:17                 
useContactSearch                                        function  apps/web/src/hooks/useSearch.ts:207:17                
useWhatsAppConnectionDetail                             function  apps/web/src/hooks/useWhatsAppConnections.ts:448:17   
getRefreshToken                                         function  apps/web/src/lib/api.ts:172:17                        
getContacts                                             function  apps/web/src/lib/api.ts:399:23                        
getContact                                              function  apps/web/src/lib/api.ts:408:23                        
updateContact                                           function  apps/web/src/lib/api.ts:412:23                        
getConversations                                        function  apps/web/src/lib/api.ts:426:23                        
getConversation                                         function  apps/web/src/lib/api.ts:435:23                        
updateConversation                                      function  apps/web/src/lib/api.ts:441:23                        
getMessages                                             function  apps/web/src/lib/api.ts:463:23                        
sendMessage                                             function  apps/web/src/lib/api.ts:475:23                        
deleteMessage                                           function  apps/web/src/lib/api.ts:485:23                        
healthCheck                                             function  apps/web/src/lib/api.ts:558:23                        
getWhatsAppConnection                                   function  apps/web/src/lib/api.ts:643:23                        
sendWhatsAppMessage                                     function  apps/web/src/lib/api.ts:720:23                        
getNotificationById                                     function  apps/web/src/lib/api.ts:1064:23                       
createNotification                                      function  apps/web/src/lib/api.ts:1080:23                       
getQuickReplyById                                       function  apps/web/src/lib/api.ts:1177:23                       
getWhatsAppLabel                                        function  apps/web/src/lib/api.ts:1324:23                       
default                                                           apps/web/src/lib/notifications.ts:322:8               
selectSelectedConversation                                        apps/web/src/stores/chat-store.ts:503:14              
selectSelectedContact                                             apps/web/src/stores/chat-store.ts:505:14              
selectTypingIndicators                                            apps/web/src/stores/chat-store.ts:508:14              
selectMessages                                                    apps/web/src/stores/chat-store.ts:512:14              
selectDraftMessage                                                apps/web/src/stores/chat-store.ts:515:14              
selectLastReadMessageId                                           apps/web/src/stores/chat-store.ts:519:14              
selectHasOptimisticMessages                                       apps/web/src/stores/chat-store.ts:523:14              
selectIsMessageSelected                                           apps/web/src/stores/chat-store.ts:532:14              
generateTempId                                          function  apps/web/src/stores/chat-store.ts:537:17              
selectIsConnected                                                 apps/web/src/stores/websocket-store.ts:74:14          
selectIsConnecting                                                apps/web/src/stores/websocket-store.ts:76:14          
selectIsDisconnected                                              apps/web/src/stores/websocket-store.ts:78:14          
selectHasError                                                    apps/web/src/stores/websocket-store.ts:80:14          
rollbackMigration                                       function  packages/database/src/migrator.ts:34:23               
Unused exported types (15)
Env                                              type       apps/api/src/lib/env.ts:78:13               
SendMessageCommand                               interface  apps/api/src/lib/nats.ts:73:18              
LabelsEvent                                      interface  apps/api/src/lib/nats.ts:197:18             
CatalogsEvent                                    interface  apps/api/src/lib/nats.ts:209:18             
CatalogProductsEvent                             interface  apps/api/src/lib/nats.ts:225:18             
ExportFormat                      exportService  type       apps/api/src/services/export.service.ts:8:13
WhatsAppConnectionsListResponse                  interface  apps/web/src/lib/api.ts:614:18              
CreateWhatsAppConnectionResponse                 interface  apps/web/src/lib/api.ts:621:18              
WhatsAppConnectionDetailResponse                 interface  apps/web/src/lib/api.ts:627:18              
NotificationType                                 type       apps/web/src/lib/notifications.ts:7:13      
PresencePayload                                  interface  apps/web/src/lib/websocket.ts:54:18         
ErrorPayload                                     interface  apps/web/src/lib/websocket.ts:77:18         
AuthSuccessPayload                               interface  apps/web/src/lib/websocket.ts:100:18        
AuthErrorPayload                                 interface  apps/web/src/lib/websocket.ts:106:18        
GroupInfo                                        interface  apps/web/src/types/chat.ts:35:18            
Configuration hints (10)
@tailwindcss/vite                     knip.json  Remove from ignoreDependencies
tailwindcss                           knip.json  Remove from ignoreDependencies
@types/bun                            knip.json  Remove from ignoreDependencies
typescript                            knip.json  Remove from ignoreDependencies
eslint                                knip.json  Remove from ignoreDependencies
prettier                              knip.json  Remove from ignoreDependencies
biome                                 knip.json  Remove from ignoreDependencies
src/index.ts       packages/database  knip.json  Remove redundant entry pattern
src/index.ts       packages/shared    knip.json  Remove redundant entry pattern
src/index.ts       packages/ui        knip.json  Remove redundant entry pattern
