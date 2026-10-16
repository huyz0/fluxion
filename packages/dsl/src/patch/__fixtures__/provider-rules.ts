/** The structured-output subset the strict AI patch schema is held to (ADR-0035): the common ground of the providers' published limits. */
export const PROVIDER_RULES: {
  readonly maxObjectDepth: number;
  readonly maxProperties: number;
  readonly forbiddenKeywords: readonly string[];
} = {
  maxObjectDepth: 5,
  maxProperties: 100,
  forbiddenKeywords: [
    'oneOf',
    'allOf',
    'not',
    'pattern',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minItems',
    'maxItems',
    'format',
    'propertyNames',
    'default',
    'patternProperties',
    '$ref',
  ],
};
