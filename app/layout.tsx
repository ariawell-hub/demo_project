import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "단톡방 분석기",
  description: "카카오톡 채팅 CSV를 요약하고 방장용 액션 아이템을 만듭니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
