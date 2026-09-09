const SECRET_NAME = /(secret|token|password|private|credential|read_write)/i;

export function healthDocument(environment = process.env) {
  // Return booleans only. Environment values, including publishable identifiers,
  // never cross this public boundary.
  return {
    service: "likerts-control-plane",
    status: "ok",
    configuration: {
      apiOrigin: Boolean(environment.LIKERTS_PUBLIC_API_ORIGIN),
      identity: Boolean(environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    },
  };
}

export function containsSecretField(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => SECRET_NAME.test(key) || containsSecretField(child),
  );
}

export default function handler(_request, response) {
  const document = healthDocument();
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(document);
}
