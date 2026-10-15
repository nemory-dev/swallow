import { describe, expect, it } from 'vitest';
import {
  catalogs, explanationStyleMessageKeys, libraryScopeMessageKeys, pdfMethodMessageKeys,
  reviewRatingMessageKeys, studyStepMessageKeys, createTranslator, type MessageKey,
} from '../src/shared/i18n.js';
import type { ExplanationStyle, LibraryScope, PdfPage, Rating, StudyStep } from '../src/shared/types.js';

// Existing production unions are checked here without adding dependencies to the shared i18n module.
const styleKeys: Record<ExplanationStyle, MessageKey> = explanationStyleMessageKeys;
const stepKeys: Record<StudyStep, MessageKey> = studyStepMessageKeys;
const ratingKeys: Record<Rating, MessageKey> = reviewRatingMessageKeys;
const scopeKeys: Record<LibraryScope['kind'], MessageKey> = libraryScopeMessageKeys;
const methodKeys: Record<PdfPage['method'], MessageKey> = pdfMethodMessageKeys;

describe('기존 화면 enum과 번역 key의 typed mapping', () => {
  it('현재 설명 방식과 학습 단계를 모두 번역한다', () => {
    const t = createTranslator('en');
    expect(t(explanationStyleMessageKeys.relearn)).toBe('Explain again from my answer');
    expect(t(studyStepMessageKeys.check)).toBe('Check understanding');
    for (const mapping of [styleKeys, stepKeys, ratingKeys, scopeKeys, methodKeys]) {
      for (const key of Object.values(mapping)) expect(Object.hasOwn(catalogs.ko, key)).toBe(true);
    }
  });
  it('현재 자료 범위와 PDF 추출 방식 enum을 빠짐없이 포함한다', () => {
    expect(Object.keys(styleKeys).sort()).toEqual(['brief', 'example', 'relearn', 'simple']);
    expect(Object.keys(scopeKeys).sort()).toEqual(['all', 'folder', 'unfiled']);
    expect(Object.keys(methodKeys).sort()).toEqual(['empty', 'ocr', 'text']);
  });
});
