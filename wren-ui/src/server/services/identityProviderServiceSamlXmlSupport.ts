// eslint-disable-next-line @typescript-eslint/no-var-requires
const { XMLParser } = require('fast-xml-parser');

import {
  escapeCanonicalXmlAttribute,
  escapeCanonicalXmlText,
  getXmlNamePrefix,
  getXmlNamespaceDeclarationPrefix,
  XMLElementNode,
  XMLNode,
} from './identityProviderServiceShared';

export const parseXmlTree = (xml: string): XMLElementNode => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    preserveOrder: true,
    trimValues: false,
    parseTagValue: false,
    removeNSPrefix: false,
  });
  const orderedNodes = parser.parse(xml);
  const elementNodes = ensureArray(orderedNodes)
    .map((entry) => buildXmlNodeFromOrderedEntry(entry, null, {}))
    .filter(Boolean) as XMLElementNode[];
  const rootNode = elementNodes.find((node) => node.kind === 'element');
  if (!rootNode) {
    throw new Error('SAML XML root element is missing');
  }
  return rootNode;
};

const buildXmlNodeFromOrderedEntry = (
  entry: Record<string, any>,
  parent: XMLElementNode | null,
  inheritedNamespaces: Record<string, string>,
): XMLNode | null => {
  const [name] = Object.keys(entry || {}).filter((key) => key !== ':@');
  if (!name) {
    return null;
  }
  if (name === '#text') {
    return {
      kind: 'text',
      text: String(entry['#text'] || ''),
      parent,
    };
  }
  if (name.startsWith('?')) {
    return null;
  }

  const attrs = Object.fromEntries(
    Object.entries(entry[':@'] || {}).map(([key, value]) => [
      key,
      String(value ?? ''),
    ]),
  );
  const declaredNamespaces = Object.entries(attrs).reduce(
    (result, [attrName, value]) => {
      const prefix = getXmlNamespaceDeclarationPrefix(attrName);
      if (prefix == null) {
        return result;
      }
      result[prefix] = value;
      return result;
    },
    {} as Record<string, string>,
  );
  const node: XMLElementNode = {
    kind: 'element',
    name,
    attrs,
    children: [],
    parent,
    declaredNamespaces,
    namespaceMap: {
      ...inheritedNamespaces,
      ...declaredNamespaces,
    },
  };

  const childEntries = ensureArray(entry[name]);
  node.children = childEntries
    .map((childEntry) =>
      buildXmlNodeFromOrderedEntry(childEntry, node, node.namespaceMap),
    )
    .filter(Boolean) as XMLNode[];

  return node;
};

const getElementChildren = (node: XMLElementNode) =>
  node.children.filter(
    (child): child is XMLElementNode => child.kind === 'element',
  );

const findFirstChildElement = (
  node: XMLElementNode,
  predicate: (child: XMLElementNode) => boolean,
) => getElementChildren(node).find(predicate) || null;

const findDescendantElements = (
  node: XMLElementNode,
  predicate: (child: XMLElementNode) => boolean,
): XMLElementNode[] => {
  const matches: XMLElementNode[] = [];
  for (const child of getElementChildren(node)) {
    if (predicate(child)) {
      matches.push(child);
    }
    matches.push(...findDescendantElements(child, predicate));
  }
  return matches;
};

export const findElementById = (
  node: XMLElementNode,
  id: string,
): XMLElementNode | null => {
  if ((node.attrs.ID || node.attrs.Id || node.attrs.id) === id) {
    return node;
  }
  for (const child of getElementChildren(node)) {
    const matched = findElementById(child, id);
    if (matched) {
      return matched;
    }
  }
  return null;
};

const readNodeText = (node: XMLElementNode | null): string | null => {
  if (!node) {
    return null;
  }
  const value = node.children
    .map((child) =>
      child.kind === 'text' ? child.text : readNodeText(child) || '',
    )
    .join('')
    .trim();
  return value || null;
};

export const canonicalizeXmlNode = (
  node: XMLElementNode,
  options?: {
    excludeNode?: XMLElementNode | null;
    renderedNamespaces?: Record<string, string>;
  },
): string => {
  if (options?.excludeNode && node === options.excludeNode) {
    return '';
  }

  const renderedNamespaces = { ...(options?.renderedNamespaces || {}) };
  const namespaceEntries: Array<[string, string]> = [];
  const visiblePrefixes = new Set<string>([getXmlNamePrefix(node.name)]);
  const attributeEntries = Object.entries(node.attrs).filter(
    ([attrName]) => getXmlNamespaceDeclarationPrefix(attrName) == null,
  );
  for (const [attrName] of attributeEntries) {
    const attrPrefix = getXmlNamePrefix(attrName);
    if (attrPrefix) {
      visiblePrefixes.add(attrPrefix);
    }
  }
  for (const prefix of visiblePrefixes) {
    if (prefix === 'xml') {
      continue;
    }
    const namespaceUri = node.namespaceMap[prefix];
    if (
      namespaceUri !== undefined &&
      renderedNamespaces[prefix] !== namespaceUri
    ) {
      namespaceEntries.push([prefix, namespaceUri]);
      renderedNamespaces[prefix] = namespaceUri;
    }
  }
  namespaceEntries.sort(([leftPrefix], [rightPrefix]) =>
    leftPrefix.localeCompare(rightPrefix),
  );

  const sortedAttributes = attributeEntries.sort(([leftName], [rightName]) => {
    const leftPrefix = getXmlNamePrefix(leftName);
    const rightPrefix = getXmlNamePrefix(rightName);
    const leftNamespace = leftPrefix ? node.namespaceMap[leftPrefix] || '' : '';
    const rightNamespace = rightPrefix
      ? node.namespaceMap[rightPrefix] || ''
      : '';
    if (leftNamespace !== rightNamespace) {
      return leftNamespace.localeCompare(rightNamespace);
    }
    return leftName.localeCompare(rightName);
  });

  const namespaceXml = namespaceEntries
    .map(([prefix, value]) =>
      prefix
        ? ` xmlns:${prefix}="${escapeCanonicalXmlAttribute(value)}"`
        : ` xmlns="${escapeCanonicalXmlAttribute(value)}"`,
    )
    .join('');
  const attributesXml = sortedAttributes
    .map(
      ([name, value]) =>
        ` ${name}="${escapeCanonicalXmlAttribute(String(value))}"`,
    )
    .join('');
  const childrenXml = node.children
    .map((child) =>
      child.kind === 'text'
        ? escapeCanonicalXmlText(child.text)
        : canonicalizeXmlNode(child, {
            excludeNode: options?.excludeNode || null,
            renderedNamespaces,
          }),
    )
    .join('');

  return `<${node.name}${namespaceXml}${attributesXml}>${childrenXml}</${node.name}>`;
};

export const samlXmlTreeSupport = {
  findDescendantElements,
  findFirstChildElement,
  getElementChildren,
  readNodeText,
};

const ensureArray = <T>(value: T | T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : value ? [value] : [];
