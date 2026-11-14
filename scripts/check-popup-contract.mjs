import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const popupUrl = new URL('../src/client/components/PopupSelectView.tsx', import.meta.url);
const menuUrl = new URL('../src/client/components/MenuSurface.tsx', import.meta.url);
const surfaceUrl = new URL('../src/client/components/CodinputSurface.tsx', import.meta.url);
const stylesUrl = new URL('../src/client/styles.ts', import.meta.url);
const [popupSource, menuSource, surfaceSource, styleSource] = await Promise.all([
  readFile(popupUrl, 'utf8'),
  readFile(menuUrl, 'utf8'),
  readFile(surfaceUrl, 'utf8'),
  readFile(stylesUrl, 'utf8'),
]);

function parseTsx(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function jsxTagName(node) {
  const tag = ts.isJsxSelfClosingElement(node) ? node.tagName : node.tagName;
  return ts.isIdentifier(tag) ? tag.text : tag.getText();
}

function findJsxTags(sourceFile, name) {
  const tags = [];
  walk(sourceFile, (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && jsxTagName(node) === name) {
      tags.push(node);
    }
  });
  return tags;
}

function findAttribute(tag, name) {
  return tag?.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === name);
}

function expressionText(attribute) {
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression
    ? attribute.initializer.expression.getText()
    : null;
}

const popupFile = parseTsx('PopupSelectView.tsx', popupSource);
const menuFile = parseTsx('MenuSurface.tsx', menuSource);
const surfaceFile = parseTsx('CodinputSurface.tsx', surfaceSource);
const classNames = new Set();
let viewportCount = 0;
walk(popupFile, (node) => {
  if (!ts.isJsxAttribute(node) || node.name.text !== 'className' || !node.initializer || !ts.isStringLiteral(node.initializer)) return;
  for (const className of node.initializer.text.split(/\s+/)) {
    if (!className.startsWith('dci-')) continue;
    classNames.add(className);
    if (className === 'dci-viewport') viewportCount += 1;
  }
});

const missing = [...classNames].filter((className) => {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !new RegExp(`\\.${escaped}(?![\\w-])`).test(styleSource);
});

const popupMenuTags = findJsxTags(popupFile, 'MenuSurface');
const popupViewTags = findJsxTags(surfaceFile, 'PopupSelectView');
const popupMenuTag = popupMenuTags.length === 1 ? popupMenuTags[0] : null;
const popupViewTag = popupViewTags.length === 1 ? popupViewTags[0] : null;
const dismissAttribute = findAttribute(popupMenuTag, 'dismissOnAnchorPointerDown');
let hasBodyPortal = false;
walk(menuFile, (node) => {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'createPortal') return;
  const target = node.arguments[1];
  if (target && ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)
    && target.expression.text === 'document' && target.name.text === 'body') {
    hasBodyPortal = true;
  }
});

const errors = [];
if (missing.length > 0) {
  errors.push(`PopupSelectView styles missing selectors: ${missing.join(', ')}`);
}
if (popupMenuTags.length !== 1 || expressionText(findAttribute(popupMenuTag, 'anchor')) !== 'anchorRef.current') {
  errors.push('PopupSelectView must use exactly one shared MenuSurface anchored to anchorRef.current');
}
if (!dismissAttribute || dismissAttribute.initializer !== undefined) {
  errors.push('PopupSelectView must dismiss when the composer anchor is clicked');
}
if (expressionText(findAttribute(popupMenuTag, 'wrapViewport')) !== 'false' || viewportCount !== 1) {
  errors.push('PopupSelectView must provide exactly one scrolling viewport and disable the MenuSurface wrapper');
}
if (popupViewTags.length !== 1 || expressionText(findAttribute(popupViewTag, 'popup')) !== 'popup'
  || expressionText(findAttribute(popupViewTag, 'anchorRef')) !== 'cardRef') {
  errors.push('CodinputSurface must pass popup and its card anchor to exactly one PopupSelectView');
}
if (!hasBodyPortal) {
  errors.push('MenuSurface must portal fixed menus to document.body');
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`PopupSelectView contract OK (${classNames.size} styled classes + anchored portal)`);
}
