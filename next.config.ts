import type { NextConfig } from 'next'

const config: NextConfig = {
  // Витрина каждого продавца живёт на своём поддомене, поэтому
  // изображения приходят с домена Storage нашего проекта Supabase.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
}

export default config
