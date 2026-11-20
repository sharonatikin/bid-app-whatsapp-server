// lib/server/images.ts
export const imageUrl = (key, variant) => {
  if (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('/uploads/')) {
    return key;
  }
  return variant === 'thumb' ? `/api/images/${key}?size=thumb` : `/api/images/${key}`;
};