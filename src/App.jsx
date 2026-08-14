'use client'

import { useEffect, useRef, useState } from 'react'
import MiniConsultationCalendar from './components/marketing/MiniConsultationCalendar'

const LOGO_URL = 'https://framerusercontent.com/images/umHNWFzfNiwMjUFM1F5u3PfOa4U.png'
const CLOUD_URL = 'https://framerusercontent.com/images/nj4J6jsjd5DicG7zzMA3Gvj0Bg.webp'
const CHART_URL = 'https://framerusercontent.com/images/fjm1CJNaRnlFCCezhLqox2Tbibk.jpg'
const APP_URL = 'https://framerusercontent.com/images/BXcKAWwzIpif2PewHLzr0dQftxM.webp'

function useAccountCta(isAuthenticated = false) {
  const [hasKnownAccount, setHasKnownAccount] = useState(isAuthenticated)

  useEffect(() => {
    if (isAuthenticated) {
      window.localStorage.setItem('spottex_has_account', '1')
      setHasKnownAccount(true)
      return
    }
    setHasKnownAccount(window.localStorage.getItem('spottex_has_account') === '1')
  }, [isAuthenticated])

  if (isAuthenticated) return { href: '/app/dashboard', label: 'Otevřít aplikaci' }
  if (hasKnownAccount) return { href: '/prihlaseni', label: 'Přihlásit se' }
  return { href: '/registrace', label: 'Vytvořit účet' }
}

const faqData = [
  {
    q: 'Potřebuji speciální hardware nebo zařízení?',
    a: 'Ne, žádný speciální hardware nepotřebujete. Spottex funguje čistě softwarově přes váš stávající Solax Cloud účet. Stačí mít fotovoltaický systém Solax s aktivním přístupem do Solax Cloudu.',
  },
  {
    q: 'Kolik služba stojí?',
    a: 'Prvních 30 dní je zdarma. Potom si vyberete měsíční variantu za 15 % ze skutečně dosažené úspory, maximálně 99 Kč měsíčně, nebo roční variantu za 12,5 % z úspory, maximálně 999 Kč ročně.',
  },
  {
    q: 'Můžu službu nejprve vyzkoušet?',
    a: 'Ano. Prvních 30 dní provozu je zdarma a bez závazků. Řízení se nikdy nezapne samo — aktivujete ho až po kontrole výpočtu a podmínek.',
  },
  {
    q: 'Jak probíhá připojení k Solax Cloudu?',
    a: 'Připojení je jednoduché a trvá přibližně 2 minuty. V aplikaci zadáte přihlašovací údaje k vašemu Solax Cloud účtu a Spottex se připojí automaticky. Není potřeba nic instalovat ani technicky nastavovat.',
  },
  {
    q: 'Jak velkou úsporu mohu očekávat?',
    a: 'Úspora závisí na elektrárně, baterii, spotřebě, sazbě a cenách energie. Proto nejdřív zdarma stáhneme historii a přibližně do hodiny připravíme výpočet pro váš konkrétní provoz.',
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

const accountMenuItems = [
  { href: '/registrace', label: 'Registrovat se' },
  { href: '/prihlaseni', label: 'Přihlásit se' },
  { href: '/app/dashboard', label: 'Otevřít aplikaci' },
]

export function Nav({ isAuthenticated = false }) {
  const accountCta = useAccountCta(isAuthenticated)
  // The suggested action stays one click away, but every account action has to
  // remain reachable: someone signed in still needs to create an account for
  // another person.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <nav className="nav">
      <a href="/" className="nav-logo">
        <img src={LOGO_URL} alt="Spottex" />
      </a>
      <div className="nav-links">
        <a href="/rizeni">Řízení</a>
        <a href="/konzultace">Konzultace</a>
        <a href="/blog">Blog</a>
      </div>
      <div className="nav-account" ref={menuRef}>
        <a href={accountCta.href} className="nav-cta nav-cta-split">
          {accountCta.label}
        </a>
        <button
          type="button"
          className="nav-cta-toggle"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Další možnosti účtu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {menuOpen && (
          <div className="nav-account-menu" role="menu">
            {accountMenuItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                role="menuitem"
                className="nav-account-menu-item"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="hero-video-wrap">
        <video
          src="/spottex_web_v2.mp4"
          poster="/spottex_web_v2_poster.jpg"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        />
      </div>
      <div className="hero-shade" />
      <div className="hero-copy">
        <p className="hero-kicker">Spottex · chytré řízení energie</p>
        <h1>Začněte opravdu šetřit<br />s vaší fotovoltaikou!</h1>
        <p>Propojíte SolaX Cloud, přibližně do hodiny uvidíte vlastní potenciál úspor a řízení zapnete až ve chvíli, kdy budete znát výsledek. Bez instalace dalšího hardwaru.</p>
      </div>
      <a className="hero-scroll" href="#aplikace" aria-label="Přejít k ukázce řízení">Jak funguje řízení <span>↓</span></a>
    </section>
  )
}

function AppShowcase({ isAuthenticated = false }) {
  const accountCta = useAccountCta(isAuthenticated)

  return (
    <section className="app-showcase" id="aplikace">
      <div className="app-showcase-inner">
        <div className="app-showcase-copy">
          <span className="app-showcase-label">Spottex aplikace · aktuálně pro SolaX</span>
          <h2>Vaše elektrárna.<br />Skutečná data.</h2>
          <p>
            Stačí se přihlásit a propojit SolaX Cloud. Bez další krabičky a bez zásahu do elektroinstalace
            stáhneme historii výroby a spotřeby, porovnáme tarify, baterii i chytré řízení a zhruba do hodiny ukážeme možnou úsporu.
          </p>
          <ul className="app-showcase-points">
            <li>Výpočet úspor je zdarma</li>
            <li>Řízení zůstává do vašeho potvrzení vypnuté</li>
            <li>Průběh výpočtu i výsledky sledujete online</li>
          </ul>
          <div className="app-showcase-actions">
            <a href={accountCta.href} className="figma-button">Spočítat úsporu zdarma</a>
            <a href="/rizeni" className="figma-link">Jak řízení funguje →</a>
          </div>
        </div>

        <div className="phone-stage" aria-label="Ukázka mobilní aplikace Spottex">
          <div className="phone-orbit phone-orbit--one" />
          <div className="phone-orbit phone-orbit--two" />
          <div className="spottex-phone spottex-phone--back">
            <div className="spottex-phone-notch" />
            <div className="spottex-phone-screen">
              <img src="/spottex_app_nahled_1.png" alt="Obrazovka aplikace Spottex s grafem výroby a spotřeby energie" loading="lazy" />
            </div>
          </div>
          <div className="spottex-phone spottex-phone--front">
            <div className="spottex-phone-notch" />
            <div className="spottex-phone-screen">
              <img src="/spottex_app_nahled_2.png" alt="Obrazovka aplikace Spottex s aktuální výrobou, spotřebou a stavem baterie" loading="lazy" />
            </div>
          </div>
          <div className="phone-trust-badge">
            <span>Bez dalšího hardwaru</span>
            <strong>SolaX Cloud</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function TimelineSection() {
  const milestones = [
    { state: 'hotovo', title: 'Energetické studie', text: 'Simulace výroby, spotřeby, baterií a distribučních sazeb nad reálnými daty.' },
    { state: 'hotovo', title: 'Sběr dat ze SolaX', text: 'Bez dalšího hardwaru ukládáme výrobu, spotřebu, baterii a tok energie v čase.' },
    { state: 'nyni', title: 'Chytré řízení FVE', text: 'Pilotujeme bezpečné řízení střídače podle cen, predikce a potřeb domácnosti.' },
    { state: 'dalsi', title: 'Řízení spotřebičů', text: 'Zapojíme ohřev vody, nabíjení auta a další flexibilní spotřebu.' },
    { state: 'dalsi', title: 'Komunitní sdílení', text: 'Budeme koordinovat výrobu a spotřebu mezi domácnostmi a firmami.' },
    { state: 'dalsi', title: 'Obchodník s energiemi', text: 'Propojíme řízení zařízení s nákupem, prodejem a chytrým tarifem.' },
  ]

  return (
    <section className="journey-section" id="o-nas">
      <div className="journey-inner">
        <div className="journey-heading">
          <span>Naše cesta</span>
          <h2>Nestavíme slib. Stavíme na datech.</h2>
          <p>Začali jsme energetickými studiemi. Dnes řídíme fotovoltaiku a míříme k propojené energetice domácností, firem a komunit.</p>
        </div>
        <ol className="journey-timeline">
          {milestones.map((item, index) => (
            <li className={`journey-item journey-item--${item.state}`} key={`${item.title}-${index}`}>
              <div className="journey-marker"><span>{index + 1}</span></div>
              <div className="journey-card">
                <span className="journey-state">{item.state === 'hotovo' ? 'Hotovo' : item.state === 'nyni' ? 'Právě teď' : 'Připravujeme'}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
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
            Nejdřív nad vašimi daty prokážeme potenciál. Teprve potom rozhodnete, jestli chcete řízení aktivovat.
          </p>

          <div className="benefits-cards">
            {[
              {
                title: 'Úspora',
                desc: 'Prodáváme elektřinu, když je drahá, a nakupujeme, když je levná.',
              },
              {
                title: 'Férový model',
                desc: 'Platíte podíl ze skutečně dosažené úspory, vždy jen do jasně stanoveného měsíčního nebo ročního maxima.',
              },
              {
                title: 'Jednoduchost',
                desc: 'Stačí propojit Solax Cloud – nastavení zabere 2 minuty a dál už vše funguje samo.',
              },
              {
                title: 'Transparentnost',
                desc: 'V aplikaci vidíte vstupní data, průběh simulace, výsledek i stav řízení.',
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
            <a href="/registrace">
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
  const plans = [
    {
      name: 'Na vyzkoušení',
      price: '30 dní',
      unit: 'zdarma',
      description: 'Nejdřív si na vlastní elektrárně ověříte přínos Spottexu. Bez platby a bez automatického zapnutí řízení.',
      cta: 'Vyzkoušet zdarma',
      href: '/registrace?plan=trial',
    },
    {
      name: 'Měsíční',
      price: '15 %',
      unit: 'z úspor',
      cap: 'maximálně 99 Kč / měsíc',
      description: 'Platíte jen podle skutečně dosažené úspory. Vyhodnocení a horní limit se počítají za každý měsíc.',
      cta: 'Zvolit měsíční variantu',
      href: '/registrace?plan=monthly',
      featured: true,
    },
    {
      name: 'Roční',
      price: '12,5 %',
      unit: 'z úspor',
      cap: 'maximálně 999 Kč / rok',
      description: 'Nižší podíl z úspor při ročním vyhodnocení. Ani za celý rok nezaplatíte více než stanovený limit.',
      cta: 'Zvolit roční variantu',
      href: '/registrace?plan=yearly',
    },
  ]

  return (
    <section className="pricing-section" id="cenik">
      <div className="pricing-inner">
        <div className="section-top section-top--center">
          <Badge>Ceník</Badge>
          <HeadingRow center>Jednoduchá cena s garancí úspory</HeadingRow>
        </div>

        <p className="pricing-tagline">Začněte 30 dny zdarma. Potom platíte jen část z toho, co vám Spottex skutečně ušetří — nikdy více než uvedený limit.</p>

        <div className="pricing-grid">
          {plans.map((plan) => (
            <article className={`pricing-card${plan.featured ? ' pricing-card--featured' : ''}`} key={plan.name}>
              {plan.featured && <span className="pricing-recommended">Nejflexibilnější</span>}
              <div className="pricing-card-top">
                <h2 className="pricing-plan-name">{plan.name}</h2>
              </div>

              <div className="pricing-price-row">
                <span className="pricing-pct">{plan.price}</span>
                <span className="pricing-unit">{plan.unit}</span>
              </div>

              {plan.cap && <p className="pricing-cap">{plan.cap}</p>}
              <div className="pricing-divider" />
              <p className="pricing-desc">{plan.description}</p>

              <a href={plan.href} className="btn-primary pricing-cta">
                {plan.cta}
              </a>
            </article>
          ))}
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

function ProductHero({ isAuthenticated = false }) {
  const accountCta = useAccountCta(isAuthenticated)
  return (
    <section className="product-hero">
      <div className="product-hero-inner">
        <div className="product-hero-copy">
          <span>Spottex pro SolaX</span>
          <h1>Spočítejte úsporu dřív, než zapnete řízení.</h1>
          <p>Propojíme vaši elektrárnu bez dalšího hardwaru, stáhneme historická data a přibližně do hodiny porovnáme tarif, baterii, rozšíření FVE i chytré řízení.</p>
          <div className="product-hero-actions">
            <a href={accountCta.href} className="figma-button">Spočítat úsporu zdarma</a>
            <a href="/konzultace" className="figma-link">Domluvit konzultaci →</a>
          </div>
        </div>
        <div className="product-hero-facts">
          <article><strong>~ 1 hodina</strong><span>orientační výpočet nad historií</span></article>
          <article><strong>0 Kč</strong><span>za výpočet potenciálu úspor</span></article>
          <article><strong>0× hardware</strong><span>připojení přímo přes SolaX Cloud</span></article>
          <article><strong>Váš souhlas</strong><span>řízení se aktivuje až na váš pokyn</span></article>
        </div>
      </div>
    </section>
  )
}

function AboutHero() {
  return (
    <section className="about-hero">
      <div>
        <span>O Spottexu</span>
        <h1>Energetiku stavíme na měření, ne na dojmu.</h1>
        <p>Jsme tým z energetiky, softwaru a datové analytiky. Zkušenosti z dřívějších firem a odborných studií přenášíme do produktu, který má lidem i firmám dát kontrolu nad vlastní energií.</p>
      </div>
    </section>
  )
}

function CtaSection({ isAuthenticated = false }) {
  const accountCta = useAccountCta(isAuthenticated)
  return (
    <section className="cta-section" id="kontakt">
      <img src={CLOUD_URL} alt="" className="cta-cloud cta-cloud--l" aria-hidden="true" />
      <img src={CLOUD_URL} alt="" className="cta-cloud cta-cloud--r" aria-hidden="true" />

      <div className="cta-inner">
        <h2>Za hodinu můžete znát potenciál své elektrárny.</h2>
        <p>Propojte SolaX Cloud. Stáhneme historii, porovnáme tarif, baterii i řízení a pošleme vám výsledek. Zdarma a bez zapnutí řízení.</p>
        <a href={accountCta.href} className="cta-btn">
          Spočítat úsporu zdarma
        </a>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-left">
          <div className="footer-logo">
            <img src={LOGO_URL} alt="Spottex" />
          </div>
          <p className="footer-desc">
            Datová a řídicí platforma pro fotovoltaiku. Aktuálně propojujeme SolaX Cloud
            bez instalace dalšího hardwaru.
          </p>
        </div>

        <div className="footer-nav">
          <a href="/rizeni">Řízení</a>
          <a href="/rizeni#cenik">Ceník</a>
          <a href="/konzultace">Konzultace</a>
          <a href="/blog">Blog</a>
          <a href="/prihlaseni">Přihlášení</a>
        </div>

        <div className="footer-right">
          <div className="footer-legal">
            <a href="/obchodni-podminky">Podmínky použití</a>
            <a href="/ochrana-osobnich-udaju">Zpracování osobních údajů</a>
            <button type="button" onClick={() => window.dispatchEvent(new Event('spottex:open-consent'))}>Nastavení cookies</button>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Spottex Energy s.r.o. | Všechna práva vyhrazena</span>
      </div>
    </footer>
  )
}

/** @param {{ publicContent?: import('react').ReactNode, isAuthenticated?: boolean }} props */
export default function App({ publicContent = null, isAuthenticated = false }) {
  return (
    <>
      <Nav isAuthenticated={isAuthenticated} />
      <Hero />
      <AppShowcase isAuthenticated={isAuthenticated} />
      <TimelineSection />
      {publicContent}
      <Footer />
    </>
  )
}

/** @param {{ isAuthenticated?: boolean }} props */
export function ProductMarketingPage({ isAuthenticated = false }) {
  return (
    <>
      <Nav isAuthenticated={isAuthenticated} />
      <ProductHero isAuthenticated={isAuthenticated} />
      <MiniConsultationCalendar />
      <ProblemSection />
      <ReseniSection />
      <BenefitsSection />
      <HowSection />
      <PricingSection />
      <FaqSection />
      <CtaSection isAuthenticated={isAuthenticated} />
      <Footer />
    </>
  )
}

/** @param {{ publicContent?: import('react').ReactNode, isAuthenticated?: boolean }} props */
export function AboutMarketingPage({ publicContent = null, isAuthenticated = false }) {
  return (
    <>
      <Nav isAuthenticated={isAuthenticated} />
      <AboutHero />
      <TimelineSection />
      {publicContent}
      <Footer />
    </>
  )
}
