import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GoTogether',
    short_name: 'GoTogether',
    description: 'Find travel companions, host or join trips, and travel together.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F2F3EE',
    theme_color: '#1F6F6B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
