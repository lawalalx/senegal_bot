import "dotenv/config";
import { createAzure } from "@ai-sdk/azure";
import { openai } from "@ai-sdk/openai";

const requestedAzureApiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim();
// Some resources reject 2024-12-01-preview for /responses; use a safer fallback.
const resolvedAzureApiVersion =
  !requestedAzureApiVersion || requestedAzureApiVersion === "2024-12-01-preview"
    ? "preview"
    : requestedAzureApiVersion;

const azureConfigured =
  !!(process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_BASE_URL || process.env.AZURE_RESOURCE_NAME) &&
  !!process.env.AZURE_OPENAI_API_KEY;

const azureProvider = azureConfigured
  ? createAzure({
      baseURL: process.env.AZURE_OPENAI_BASE_URL || process.env.AZURE_OPENAI_ENDPOINT,
      resourceName: process.env.AZURE_RESOURCE_NAME,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: resolvedAzureApiVersion,
    })
  : null;

export function getChatModel(modelName = process.env.OPENAI_MODEL || "gpt-4o-mini") {
  if (azureProvider) {

    console.log(`\n\nUsing Azure OpenAI provider with deployment: ${process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_DEPLOYMENT_NAME || modelName} and API version: ${resolvedAzureApiVersion}`);
    return azureProvider.chat(process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_DEPLOYMENT_NAME || modelName);
  }

  console.log(`\n\nUsing OpenAI provider with model: ${modelName}`);
  return openai(modelName);
}

export function getEmbeddingModel(modelName = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small") {
  if (azureProvider) {
    return azureProvider.embedding(process.env.AZURE_OPENAI_EMBEDDING_MODEL || modelName);
  }

  return openai.embedding(modelName);
}
