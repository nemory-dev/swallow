import { describe, expect, it } from 'vitest';
import { errorText, localizeText, PublicError, toPublicError, restorePublicError } from '../src/shared/public-errors.js';
import { safeError } from '../electron/app-service.js';

describe('공개 오류와 상태 allowlist', () => {
  it('업데이트 설치 중 차단 안내를 공개 code와 한영 복구 문구로 보존한다', () => {
    const envelope = toPublicError(new Error('업데이트를 적용하는 중입니다. 잠시 기다려 주세요.'));
    expect(envelope).toEqual({ code: 'public.updateInstallingBusy' });
    const restored = restorePublicError(JSON.parse(JSON.stringify(envelope)));
    expect(errorText(restored, 'ko')).toContain('업데이트를 적용');
    expect(errorText(restored, 'en')).toContain('applying the update');
  });
  it.each(['token SECRET /Users/private/data', '오류 SECRET /Users/private/data', '<script>SECRET</script>'])('raw 오류 %s를 언어와 무관하게 차단한다', raw => {
    for (const locale of ['ko', 'en'] as const) {
      expect(errorText(new Error(raw), locale)).not.toContain('SECRET');
      expect(safeError(new Error(raw))).not.toContain('SECRET');
      expect(localizeText(raw, locale)).not.toContain('SECRET');
    }
  });
  it('앱 소유 코드를 직렬화/복원하고 locale에 맞게 표시한다', () => {
    const envelope = toPublicError(new PublicError('language.saveFailed'));
    expect(envelope).toEqual({ code: 'language.saveFailed' });
    expect(errorText(restorePublicError(envelope), 'en')).toContain('previous settings');
    expect(errorText(restorePublicError({ code: '__proto__', message: 'SECRET' }), 'en')).not.toContain('SECRET');
  });
  it('외부 제공자 오류는 앱 소유 공개 코드로 오인하지 않는다', () => {
    const known = Object.assign(new Error('raw SECRET'), { name: 'UntrustedProviderError', code: 'cancelled' });
    expect(toPublicError(known)).toEqual({ code: 'errors.unexpected' });
    const unknown = Object.assign(new Error('raw SECRET'), { name: 'UntrustedProviderError', code: 'SECRET' });
    expect(JSON.stringify(toPublicError(unknown))).not.toContain('SECRET');
  });
  it('명시적으로 등록한 정적 상태만 재번역한다', () => {
    expect(localizeText('최신 버전입니다.', 'en')).toBe('You’re up to date.');
    expect(localizeText('You’re up to date.', 'ko')).toBe('최신 버전입니다.');
    expect(errorText(new Error('AI가 제시한 인용이 이 원문에 없습니다. 안내를 저장하지 않았습니다.'), 'ko')).toContain('인용');
  });
  it('외부 오류 code와 metadata를 그대로 공개하지 않는다', () => {
    for (const code of ['invalid_request', 'registration_failed', 'credential_encryption_unavailable']) {
      expect(toPublicError(Object.assign(new Error('SECRET'), { name: 'UntrustedProviderError', code }))).toEqual({ code: 'errors.unexpected' });
      expect(JSON.stringify(toPublicError({ code, message: 'SECRET' }))).not.toContain('SECRET');
    }
  });
});
