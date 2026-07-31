// Config
export { GcpConfig } from "./config"
export type { GcpConfigShape } from "./config"

// Firestore
export { FirestoreClient } from "./firestore/FirestoreClient"
export type { FirestoreClientShape } from "./firestore/FirestoreClient"

// Cloud Storage
export { GCSStorage } from "./storage/GCSStorage"
export type { GCSStorageShape, IArtifactStore } from "./storage/GCSStorage"

// Secret Manager
export { SecretManagerClient } from "./secretmanager/SecretManagerClient"
export type { SecretManagerClientShape } from "./secretmanager/SecretManagerClient"
export {
  createSecret,
  addSecretVersion,
  accessLatestVersion,
  destroyAllVersions,
  deleteSecret,
} from "./secretmanager/SecretManagerClient"

// Vertex AI
export { VertexAiProvider, vertexModel } from "./vertex/VertexAiProvider"
export type {
  VertexAiProviderShape,
  VertexModelId,
} from "./vertex/VertexAiProvider"

// Cloud Logging
export { CloudLogger } from "./logging/CloudLoggingExporter"
export type {
  CloudLoggerShape,
  LogSeverity,
} from "./logging/CloudLoggingExporter"
