"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/dashboard", label: "Dashboard", icon: "🏠" },
  { href: "/schedule",  label: "Schedule",  icon: "📅" },
  { href: "/readiness", label: "Readiness", icon: "📈" },
  { href: "/about",     label: "Profile",   icon: "👤" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-[#1A1A1A]/95 backdrop-blur border-t border-[#2A2A2A]">
      <div className="max-w-lg mx-auto flex">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-xs transition-colors ${
                active ? "text-[#00E5A0]" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
