export interface ValidationResult {
  valid: boolean;
  message: string | null;
}

export function validateDisplayName(displayName: string): ValidationResult {
  let message = null;
  let valid = true;

  const allowableSyntaxRegex = /^[A-Za-z0-9 !@#$%^&*()_+{}[\],.'"-]*$/;
  const syntaxValid = allowableSyntaxRegex.test(displayName);
  if (!syntaxValid) {
    valid = false;
    message =
      'Only space & [  a-z, A-Z, 0-9, _, -, !@#$%^&*()-+{}[]\'".,  ] are allowed.';
  }
  const startWithLetterRegex = /^[A-Za-z]/;
  const startWithLetterValid = startWithLetterRegex.test(displayName);
  if (!startWithLetterValid) {
    valid = false;
    message = 'Must start with a letter.';
  }

  return {
    valid,
    message,
  };
}

export function replaceAllowableSyntax(str: string) {
  const replacedStr = str.replace(/[!@#$%^&*()+{}[\]'",. -]/g, '_');
  return replacedStr;
}
