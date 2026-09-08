import { buildFalInput, FAL_LITE_EDIT, FAL_LITE_T2I, FAL_PRO_T2I, parseFalImages, userMessageForFal } from '../lib/fal';

describe('buildFalInput', () => {
  it('builds t2i and edit inputs', () => {
    expect(buildFalInput({ prompt: 'P', size: 'portrait_4_3' })).toEqual({
      prompt: 'P', image_size: 'portrait_4_3', num_images: 1, enable_safety_checker: true,
    });
    expect(buildFalInput({ prompt: 'P', size: 'auto_2K', refDataUris: ['data:image/jpeg;base64,AA'] }))
      .toMatchObject({ image_urls: ['data:image/jpeg;base64,AA'] });
  });
});

describe('parseFalImages', () => {
  it('extracts urls and rejects empty results', () => {
    expect(parseFalImages({ images: [{ url: 'https://x/1.png' }] })).toEqual(['https://x/1.png']);
    expect(parseFalImages({ images: [] })).toEqual([]);
    expect(parseFalImages({})).toEqual([]);
  });
});

describe('userMessageForFal', () => {
  it('maps status codes to friendly text', () => {
    expect(userMessageForFal(401)).toContain('Key');
    expect(userMessageForFal(429)).toContain('稍后');
    expect(userMessageForFal(403)).toContain('拦截');
    expect(userMessageForFal(500)).toContain('服务');
  });
});
