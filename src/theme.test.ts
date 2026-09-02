jest.mock('react-native', () => ({ useColorScheme: jest.fn() }));

import { brand, dark, light } from './theme';

const HEX = /^#[0-9A-F]{6}$/i;

describe('theme tokens', () => {
  it('light and dark define the same keys', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('every token is a full hex color', () => {
    for (const palette of [light, dark, brand]) {
      for (const [key, value] of Object.entries(palette)) {
        expect({ key, value }).toEqual({ key, value: expect.stringMatching(HEX) });
      }
    }
  });

  it('accent matches the brand teal in light mode', () => {
    expect(light.accent).toBe(brand.teal);
  });
});
