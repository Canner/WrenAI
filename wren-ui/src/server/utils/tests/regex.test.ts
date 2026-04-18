import { validateDisplayName, replaceAllowableSyntax } from '../regex';

describe('validateDisplayName', () => {
  it('should return valid when displayName contains only allowable syntax and start with a letter', () => {
    // Arrange
    const displayName = 'Valid Display Name !@#$%^&*()_+{}[].,"\'';

    // Act
    const result = validateDisplayName(displayName);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.message).toBeNull();
  });

  it.each([['~'], ['<'], ['\\'], ['>'], ['?']])(
    'should return invalid when displayName contains invalid syntax: %s',
    ([invalidSyntax]) => {
      // Arrange
      const displayName = `Invalid Display Name ${invalidSyntax}`;

      // Act
      const result = validateDisplayName(displayName);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.message).toBe(
        'Only space & [  a-z, A-Z, 0-9, _, -, !@#$%^&*()-+{}[]\'".,  ] are allowed.',
      );
    },
  );
  it.each([['@'], ['1'], [' ']])(
    'should return invalid when displayName does not start with a letter',
    ([invalidSyntax]) => {
      // Arrange
      const displayName = `${invalidSyntax}Display Name`;

      // Act
      const result = validateDisplayName(displayName);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Must start with a letter.');
    },
  );
});

describe('replaceAllowableSyntax', () => {
  it('should replace allowable syntax characters with underscores', () => {
    // Arrange
    const str = 'Replace   !@#$%^&*() -+{}[],\'".';

    // Act
    const result = replaceAllowableSyntax(str);

    // Assert
    expect(result).toBe('Replace________________________');
    expect(result.length).toBe(str.length);
  });
});
