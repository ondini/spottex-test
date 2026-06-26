import { useState } from 'react'
import './index.css'

const LOGO_URL = 'https://framerusercontent.com/images/umHNWFzfNiwMjUFM1F5u3PfOa4U.png'
const PHONE_URL = 'https://framerusercontent.com/images/ITU2wGDMswuT7warFNMXal9AOjQ.png'
const CLOUD_URL = 'https://framerusercontent.com/images/nj4J6jsjd5DicG7zzMA3Gvj0Bg.webp'
const CHART_URL = 'https://framerusercontent.com/images/fjm1CJNaRnlFCCezhLqox2Tbibk.jpg'
const APP_URL = 'https://framerusercontent.com/images/BXcKAWwzIpif2PewHLzr0dQftxM.webp'
const VIDEO_URL = 'https://framerusercontent.com/assets/V9SkoRvPZYT1Y9hArxh9cYxdQLA.mp4'

const faqData = [
  {
    q: 'Potřebuji speciální hardware nebo zařízení?',
    a: 'Ne, žádný speciální hardware nepotřebujete. Spottex funguje čistě softwarově přes váš stávající Solax Cloud účet. Stačí mít fotovoltaický systém Solax s aktivním přístupem do Solax Cloudu.',
  },
  {
    q: 'Kolik služba stojí?',
    a: 'Účtujeme pouze 20 % z dosažených úspor. Pokud vám nic neušetříme, neplatíte vůbec nic. Žádné paušální poplatky, žádné skryté náklady. Platba probíhá automaticky měsíčně.',
  },
  {
    q: 'Můžu službu nejprve vyzkoušet?',
    a: 'Ano! Nabízíme 30 dní testovacího běhu zcela zdarma a bez závazků. Po uplynutí zkušebního období se automaticky přepnete na standardní model — 20 % z úspor.',
  },
  {
    q: 'Jak probíhá připojení k Solax Cloudu?',
    a: 'Připojení je jednoduché a trvá přibližně 2 minuty. V aplikaci zadáte přihlašovací údaje k vašemu Solax Cloud účtu a Spottex se připojí automaticky. Není potřeba nic instalovat ani technicky nastavovat.',
  },
  {
    q: 'Jak velkou úsporu mohu očekávat?',
    a: 'Úspora závisí na velikosti vaší fotovoltaiky, spotřebě a aktuálních cenách energií. Průměrní uživatelé šetří 5 000–10 000 Kč ročně díky optimálnímu načasování nákupu a prodeje elektřiny.',
  },
  {
    q: 'Jsou moje data v bezpečí?',
    a: 'Bezpečnost vašich dat bereme velmi vážně. Veškerá komunikace je šifrována a přístupové údaje jsou uloženy bezpečně. Spottex splňuje veškeré požadavky GDPR.',
  },
]

function IconBolt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

function IconShield() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function IconStar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function IconGift() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  )
}

function IconTrendDown() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconFrown() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconGooglePlay() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.18 23.76c.36.19.77.24 1.18.11l11.03-6.37-2.42-2.42-9.79 8.68zm16.95-13.21L16.8 8.19 5.3.55C4.9.31 4.47.26 4.1.43L14.54 10.87l5.59-.32zM1.03 1.57C.68 1.96.5 2.47.5 3.05v17.9c0 .58.18 1.09.53 1.48l.08.08 10.03-10.03v-.24L1.11 1.49l-.08.08zm20.3 9.45l-2.86-1.65-2.75 2.75 2.75 2.75 2.88-1.66c.82-.47.82-1.24-.02-1.19z" />
    </svg>
  )
}

function IconApple() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.63.38-1.68 1.32-1.66 3.09.03 2.44 2.14 3.24 2.17 3.27-.03.07-.34 1.15-1.27 2.27M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

function Badge({ children }) {
  return (
    <div className="badge">
      <span className="badge-dot" />
      {children}
    </div>
  )
}

function HeadingRow({ children, center }) {
  return (
    <div className={`heading-row${center ? ' heading-row--center' : ''}`}>
      <div className="heading-line" />
      <h2>{children}</h2>
      <div className="heading-line" />
    </div>
  )
}

function Nav() {
  return (
    <nav className="nav">
      <a href="#hero" className="nav-logo">
        <img src={LOGO_URL} alt="Spottex" />
      </a>
      <div className="nav-links">
        <a href="#problem">Problém</a>
        <a href="#reseni">Řešení</a>
        <a href="#cenik">Ceník</a>
        <a href="#faq">FAQ</a>
        <a href="#kontakt">Kontakt</a>
      </div>
      <a href="https://app.spottex.cz/signup" target="_blank" rel="noreferrer" className="nav-cta">
        Vyzkoušet online
      </a>
    </nav>
  )
}

function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="hero-bg" />
      <div className="hero-video-wrap">
        <video src={VIDEO_URL} autoPlay loop muted playsInline />
      </div>
      <img src={CLOUD_URL} alt="" className="hero-cloud" aria-hidden="true" />

      <div className="hero-container">
        <div className="hero-left">
          <h1>Začněte opravdu šetřit s vaší fotovoltaikou!</h1>

          <p className="hero-sub">
            Využijte potenciál své fotovoltaiky naplno bez nákladů na další hardware.
            Zajistíme optimální práci s vyrobenou energií a minimalizaci ztrát.
          </p>

          <div className="hero-features">
            {[
              'Úspora až 10 000 Kč ročně',
              'Zařízení do 2 minut online',
              'Neplatíte pokud nešetříte',
              '30 dní zdarma, pak 20% z dosažených úspor',
            ].map((label, i) => (
              <div className="hero-feature" key={i}>
                <span className="hero-feature-dot" />
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className="hero-ctas">
            <a href="https://app.spottex.cz/signup" target="_blank" rel="noreferrer" className="btn-primary">
              Vyzkoušet online
            </a>
            <a href="https://app.spottex.cz/signup" className="btn-store">
              <IconGooglePlay />
              Stáhnout v Google Play
            </a>
            <a href="https://app.spottex.cz/signup" className="btn-store">
              <IconApple />
              Stáhnout v App Store
            </a>
          </div>
        </div>

        <div className="hero-right">
          <img src={PHONE_URL} alt="Spottex app" className="hero-phone" />
        </div>
      </div>
    </section>
  )
}

function ProblemSection() {
  return (
    <section className="problem-section" id="problem">
      <div className="problem-inner">
        <div className="section-top section-top--center">
          <Badge>Problém</Badge>
          <HeadingRow center>
            Vaše fotovoltaika vyrábí,<br />ale peníze utíkají
          </HeadingRow>
          <p className="section-sub section-sub--center">
            Většina majitelů fotovoltaiky nevyužívá plný potenciál své investice.
            Přitom řešení je jednodušší, než si myslíte.
          </p>
        </div>

        <div className="problem-cards">
          {[
            {
              Icon: IconTrendDown,
              title: 'Nevyužitý potenciál výroby',
              desc: 'Bez chytrého řízení se velká část vyrobené elektřiny promrhá nebo dokonce zaplatíte za její sdílení do sítě.',
            },
            {
              Icon: IconClock,
              title: 'Špatné načasování prodeje',
              desc: 'Energie se často prodává v době, kdy je nejlevnější — a kupuje, když je nejdražší.',
            },
            {
              Icon: IconFrown,
              title: 'Zbytečná administrativa a starosti',
              desc: 'Ruční hlídání cen a přepínání režimů bere čas, nervy i peníze.',
            },
          ].map((c, i) => (
            <div className="prob-card" key={i}>
              <div className="prob-icon">
                <c.Icon />
              </div>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="problem-glow problem-glow--l" />
      <div className="problem-glow problem-glow--c" />
      <div className="problem-glow problem-glow--r" />
    </section>
  )
}

function ReseniSection() {
  return (
    <section className="reseni-section" id="reseni">
      <div className="reseni-inner">
        <div className="section-top section-top--center">
          <Badge>Řešení</Badge>
          <HeadingRow center>
            Chytré řízení spotřeby i&nbsp;prodeje&nbsp;—<br />automaticky a&nbsp;bez práce
          </HeadingRow>
        </div>

        <p className="reseni-text">
          Výsledek? Více úspor, méně starostí — a to vše nastavené během <strong>2 minut</strong>.
        </p>

        <div className="reseni-chart">
          <img src={CHART_URL} alt="Graf úspor Spottex" />
        </div>

        <p className="reseni-subtext">
          Stačí připojit vaši fotovoltaiku přes Solax Cloud a systém se postará o vše.{' '}
          <strong>Nic neplatíte</strong>, pokud vám nic neušetříme.
        </p>
      </div>
    </section>
  )
}

function BenefitsSection() {
  return (
    <section className="benefits-section" id="prinosy">
      <div className="benefits-inner">
        <div className="benefits-left">
          <h2>Klíčové přínosy</h2>
          <p className="benefits-sub">
            Pomáháme majitelům fotovoltaiky vydělat více – automaticky, férově a bez starostí.
          </p>

          <div className="benefits-cards">
            {[
              {
                title: 'Úspora',
                desc: 'Prodáváme elektřinu, když je drahá, a nakupujeme, když je levná.',
              },
              {
                title: 'Férový model',
                desc: 'Platíte jen tehdy, pokud opravdu šetříte. Pokud nic neušetříme, neplatíte vůbec nic.',
              },
              {
                title: 'Jednoduchost',
                desc: 'Stačí propojit Solax Cloud – nastavení zabere 2 minuty a dál už vše funguje samo.',
              },
              {
                title: 'Transparentnost',
                desc: 'Žádné fixní ani skryté poplatky. Pouze provize z ušetřeného.',
              },
            ].map((b, i) => (
              <div className="benefit-card" key={i}>
                <div className="benefit-icon-box">
                  <IconCheck />
                </div>
                <div>
                  <h3>{b.title}</h3>
                  <p>{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="benefits-right">
          <div className="benefits-app-wrap">
            <a href="https://app.spottex.cz/signup" target="_blank" rel="noreferrer">
              <img src={APP_URL} alt="Spottex aplikace" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function HowSection() {
  return (
    <section className="how-section">
      <div className="how-inner">
        <div className="section-top section-top--center">
          <Badge>Jak to funguje</Badge>
          <HeadingRow center>Stačí jednou připojit, zbytek děláme my</HeadingRow>
          <div className="how-bar" />
        </div>

        <p className="how-intro">
          Stačí jednou připojit vaši fotovoltaiku k naší aplikaci. O vše ostatní se
          postaráme my – automaticky, online a bez nutnosti zásahů.
        </p>

        <div className="how-steps">
          {[
            {
              title: '1. Přihlásíte se do aplikace pomocí Solax Cloudu',
              desc: 'Jednoduše zadáte přístup k vašemu Solax Cloudu. Nemusíte nic instalovat ani nastavovat.',
            },
            {
              title: '2. Systém sleduje ceny energií',
              desc: 'Naše platforma v reálném čase hlídá tržní ceny a spotřebu.',
            },
            {
              title: '3. Plánujeme nákupy a prodeje',
              desc: 'Predikujeme spotřebu a výrobu na základě historických hodnot. Plánujeme optimální načasování.',
            },
            {
              title: '4. Šetříte automaticky',
              desc: 'Prodáváme elektřinu, když je drahá, a nakupujeme, když je levná. Vy jen sledujete úspory.',
            },
          ].map((s, i) => (
            <div className="how-step" key={i}>
              <p className="how-step-title">{s.title}</p>
              <p className="how-step-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function PricingSection() {
  return (
    <section className="pricing-section" id="cenik">
      <div className="pricing-inner">
        <div className="section-top section-top--center">
          <Badge>Ceník</Badge>
          <HeadingRow center>Jedna jednoduchá cena</HeadingRow>
        </div>

        <p className="pricing-tagline">Jednoduchý start — začínáte zdarma bez závazků</p>

        <div className="pricing-card">
          <div className="pricing-card-top">
            <h2 className="pricing-plan-name">Celoroční optimalizace</h2>
          </div>

          <div className="pricing-price-row">
            <span className="pricing-pct">20&nbsp;%</span>
            <span className="pricing-unit">z ušetřené částky</span>
          </div>

          <div className="pricing-divider" />

          <p className="pricing-desc">
            Platíte pouze pokud vám něco ušetříme. Žádné paušály ani skryté poplatky.
            Platba měsíčně automaticky, 30 dní testovacího běhu zdarma.
          </p>

          <a href="https://app.spottex.cz/signup" target="_blank" rel="noreferrer" className="btn-primary pricing-cta">
            Začít vydělávat
          </a>
        </div>
      </div>
    </section>
  )
}

function FaqSection() {
  const [open, setOpen] = useState(null)
  const half = Math.ceil(faqData.length / 2)
  const left = faqData.slice(0, half)
  const right = faqData.slice(half)

  return (
    <section className="faq-section" id="faq">
      <div className="faq-inner">
        <div className="section-top section-top--center">
          <Badge>FAQ</Badge>
          <HeadingRow center>Často kladené otázky</HeadingRow>
        </div>

        <p className="section-sub section-sub--center">
          Nejčastější dotazy k naší aplikaci. Pokud odpověď nenajdete,
          napište nám a rádi poradíme.
        </p>

        <div className="faq-grid">
          {[left, right].map((col, ci) => (
            <div className="faq-col" key={ci}>
              {col.map((item, i) => {
                const idx = ci * half + i
                const isOpen = open === idx
                return (
                  <div className={`faq-item${isOpen ? ' open' : ''}`} key={idx}>
                    <button
                      className="faq-q"
                      onClick={() => setOpen(isOpen ? null : idx)}
                    >
                      <span>{item.q}</span>
                      <div className={`faq-icon${isOpen ? ' faq-icon--open' : ''}`}>
                        <IconPlus />
                      </div>
                    </button>
                    <div className="faq-a">
                      <div className="faq-a-inner">{item.a}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CtaSection() {
  return (
    <section className="cta-section" id="kontakt">
      <img src={CLOUD_URL} alt="" className="cta-cloud cta-cloud--l" aria-hidden="true" />
      <img src={CLOUD_URL} alt="" className="cta-cloud cta-cloud--r" aria-hidden="true" />

      <div className="cta-inner">
        <h2>Připraveni šetřit s&nbsp;vaší fotovoltaikou?</h2>
        <a href="https://app.spottex.cz/signup" target="_blank" rel="noreferrer" className="cta-btn">
          Vyzkoušet zdarma
        </a>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-left">
          <div className="footer-logo">
            <img src={LOGO_URL} alt="Spottex" />
          </div>
          <p className="footer-desc">
            Chytré hospodaření s energií z fotovoltaiky&nbsp;– bez práce, bez rizika
            a bez fixních poplatků. Úspora až 10&nbsp;000&nbsp;Kč ročně díky
            automatickému nákupu a prodeji.
          </p>
        </div>

        <div className="footer-nav">
          <a href="#problem">Problém</a>
          <a href="#reseni">Řešení</a>
          <a href="#cenik">Ceník</a>
          <a href="#faq">FAQ</a>
          <a href="#kontakt">Kontakt</a>
        </div>

        <div className="footer-right">
          <div className="footer-legal">
            <a href="#">Podmínky použití</a>
            <a href="#">Zpracování osobních údajů</a>
            <a href="#">Reklamační řád</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <span>© 2025 Spottex Energy s.r.o. | Všechna práva vyhrazena</span>
        <a href="https://framer.com" target="_blank" rel="noreferrer" className="footer-framer">
          Built in Framer
        </a>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <>
      <Nav />
      <Hero />
      <ProblemSection />
      <ReseniSection />
      <BenefitsSection />
      <HowSection />
      <PricingSection />
      <FaqSection />
      <CtaSection />
      <Footer />
    </>
  )
}
