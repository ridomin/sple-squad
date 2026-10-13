const registeredSecrets = new Set<string>()
const EMPTY_LENGTH = 0
const REDACTED_VALUE = '[REDACTED]'

export function registerSensitiveValue (value: string | null | undefined): void {
  if (value !== undefined && value !== null && value.length > EMPTY_LENGTH) {
    registeredSecrets.add(value)
  }
}

export function redactSensitiveValues (
  input: string,
  additionalSecrets: string[] = []
): string {
  let output = input
  const secrets = new Set([...registeredSecrets, ...additionalSecrets])
  for (const secret of secrets) {
    if (secret.length > EMPTY_LENGTH) output = output.split(secret).join(REDACTED_VALUE)
  }
  return output
}
