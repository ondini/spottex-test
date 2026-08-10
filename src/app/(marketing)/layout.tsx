import type { Metadata } from "next";
import "../../index.css";

export const metadata: Metadata = {
  title: {
    default: "Spottex | Chytré řízení fotovoltaiky",
    template: "%s | Spottex",
  },
  description:
    "Využijte potenciál své fotovoltaiky naplno. Spottex automaticky řídí výrobu, spotřebu a prodej energie.",
};

export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
