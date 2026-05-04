export function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsText(file);
  });
}

export const extractPrivateKeyString = (content: string) => {
  // Try to match PEM format first (both regular and encrypted)
  const pemMatch = content.match(
    /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----([\s\S]*?)-----END (?:ENCRYPTED )?PRIVATE KEY-----/,
  );
  if (pemMatch) {
    return pemMatch[1].replace(/\s/g, '');
  }
  return content.trim();
};
