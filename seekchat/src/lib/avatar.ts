import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface RawImage {
  uri: string;
  width: number;
  height: number;
}

import { CropRect } from './crop';
export type { CropRect } from './crop';

/**
 * Opens the gallery (legacy intent — the modern Photo Picker path needs a
 * Google-services backport absent on this device) and returns the raw asset
 * for the crop UI. Recovers activity-restart-lost results.
 */
export async function pickRawImage(): Promise<RawImage | null> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    console.log('[seekchat:avatar] permission:', perm.status);
    if (!perm.granted) {
      Alert.alert('需要相册权限', '请在系统设置中允许应用访问相册后重试。');
      return null;
    }
    console.log('[seekchat:avatar] launching picker (legacy intent)');
    let res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      legacy: true,
    });
    if (res.canceled || !res.assets?.[0]) {
      const pending = await ImagePicker.getPendingResultAsync();
      const recovered = Array.isArray(pending)
        ? pending.find(
            (p): p is ImagePicker.ImagePickerResult => 'assets' in p && !!p.assets?.[0],
          )
        : undefined;
      if (!recovered) return null;
      console.log('[seekchat:avatar] recovered pending result');
      res = recovered;
    }
    const a = res.assets![0];
    console.log('[seekchat:avatar] picked', a.width, 'x', a.height);
    return { uri: a.uri, width: a.width ?? 0, height: a.height ?? 0 };
  } catch (e) {
    console.log('[seekchat:avatar] pick failed:', e);
    Alert.alert('选择图片失败', String(e));
    return null;
  }
}

/** Post image: resize to 720px wide, JPEG data: URI (self-contained like stickers). */
export async function renderPostImage(uri: string): Promise<string | null> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    ctx.resize({ width: 720 });
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.7,
      base64: true,
    });
    return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : null;
  } catch (e) {
    console.log('[seekchat:post-image] render failed:', e);
    return null;
  }
}

/** Crops (when rect given) and renders the 256px avatar data: URI. */
export async function renderAvatar(uri: string, rect: CropRect | null): Promise<string | null> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (rect) ctx.crop(rect);
    ctx.resize({ width: 256, height: 256 });
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.6,
      base64: true,
    });
    console.log('[seekchat:avatar] saved, base64 length:', saved.base64?.length ?? 0);
    return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : null;
  } catch (e) {
    console.log('[seekchat:avatar] render failed:', e);
    Alert.alert('头像设置失败', String(e));
    return null;
  }
}
