import "dotenv/config";
import { createAzure } from "@ai-sdk/azure";
import { openai } from "@ai-sdk/openai";

const requestedAzureApiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim();
const resolvedAzureApiVersion =
  !requestedAzureApiVersion || requestedAzureApiVersion === "2024-12-01-preview"
    ? "2024-08-01-preview"
    : requestedAzureApiVersion;

// Derive resource name from endpoint if not set explicitly.
// e.g. "https://fbn-openai-dev.openai.azure.com/" → "fbn-openai-dev"
const resourceName =
  process.env.AZURE_RESOURCE_NAME ||
  process.env.AZURE_OPENAI_ENDPOINT?.match(/https?:\/\/([^.]+)\.openai\.azure\.com/)?.[1];

const azureConfigured = !!resourceName && !!process.env.AZURE_OPENAI_API_KEY;

const azureProvider = azureConfigured
  ? createAzure({
      resourceName,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: resolvedAzureApiVersion,
    })
  : null;

export function getChatModel(modelName = process.env.OPENAI_MODEL || "gpt-4o-mini") {
  if (azureProvider) {
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_DEPLOYMENT_NAME || modelName;
    console.log(`\n\nUsing Azure OpenAI provider — resource: ${resourceName}, deployment: ${deployment}, api-version: ${resolvedAzureApiVersion}`);
    return azureProvider.chat(deployment);
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
