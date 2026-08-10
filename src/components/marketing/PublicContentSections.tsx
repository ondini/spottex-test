import { prisma } from "@/lib/prisma";

export async function FounderSection() {
  const founders = await prisma.founder
    .findMany({
      where: { published: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    })
    .catch(() => []);

  if (founders.length === 0) return null;

  return (
    <section className="public-content-section public-content-section--founders" id="zakladatele" aria-labelledby="founders-title">
      <div className="public-content-inner">
        <div className="section-top section-top--center">
          <div className="badge">
            <span className="badge-dot" />
            Náš tým
          </div>
          <div className="heading-row heading-row--center">
            <div className="heading-line" />
            <h2 id="founders-title">Lidé za Spottexem</h2>
            <div className="heading-line" />
          </div>
          <p className="section-sub section-sub--center">
            Spottex staví Anna Zderadičková a Jiří Šrámek. Propojují vývoj datových produktů s praktickou elektrotechnikou a realizací fotovoltaiky.
          </p>
        </div>

        <div className="founder-grid">
          {founders.map((founder) => (
            <article className="founder-card" key={founder.id}>
              {founder.photoUrl?.includes("anna-zderadickova-reframed") ? (
                <div
                  className="founder-photo founder-photo--anna-collage"
                  role="img"
                  aria-label={founder.name}
                  style={{ backgroundImage: `url(${founder.photoUrl})` }}
                />
              ) : founder.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={founder.photoUrl} alt={founder.name} className="founder-photo" />
              ) : (
                <div className="founder-photo founder-photo--placeholder" aria-hidden="true">
                  {founder.name.slice(0, 1).toLocaleUpperCase("cs-CZ")}
                </div>
              )}
              <div className="founder-card-copy">
                <h3>{founder.name}</h3>
                {founder.title && <div className="founder-title">{founder.title}</div>}
                {founder.bio && <p>{founder.bio}</p>}
                <div className="founder-links">
                  {founder.linkedInUrl && (
                    <a href={founder.linkedInUrl} target="_blank" rel="noreferrer">
                      LinkedIn
                    </a>
                  )}
                  {founder.email && <a href={`mailto:${founder.email}`}>E-mail</a>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export async function ReferenceProjectSection() {
  const projects = await prisma.referenceProject
    .findMany({
      where: { published: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 12,
    })
    .catch(() => []);

  if (projects.length === 0) return null;

  return (
    <section className="public-content-section public-content-section--references" id="reference" aria-labelledby="references-title">
      <div className="public-content-inner">
        <div className="section-top section-top--center">
          <div className="badge">
            <span className="badge-dot" />
            Reference
          </div>
          <div className="heading-row heading-row--center">
            <div className="heading-line" />
            <h2 id="references-title">Firmy a projekty, na kterých stavíme</h2>
            <div className="heading-line" />
          </div>
          <p className="section-sub section-sub--center">
            Kompetence Spottexu nevznikla přes noc. Navazujeme na firmy a odborné zázemí, které lidé ze Spottexu vybudovali nebo dlouhodobě rozvíjejí.
          </p>
        </div>

        <div className="reference-grid">
          {projects.map((project) => {
            const content = (
              <>
                {project.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.imageUrl} alt="" className="reference-image" />
                )}
                {!project.imageUrl && (
                  <div className="reference-image reference-image--placeholder" aria-hidden="true">
                    {project.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toLocaleUpperCase("cs-CZ")}
                  </div>
                )}
                <div className="reference-copy">
                  {project.location && <div className="reference-location">{project.location}</div>}
                  <h3>{project.name}</h3>
                  {project.description && <p>{project.description}</p>}
                  {project.url && <span className="reference-link-label">Zobrazit projekt →</span>}
                </div>
              </>
            );

            return project.url ? (
              <a
                href={project.url}
                target="_blank"
                rel="noreferrer"
                className="reference-card"
                key={project.id}
              >
                {content}
              </a>
            ) : (
              <article className="reference-card" key={project.id}>
                {content}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function PublicContentSections() {
  return (
    <>
      <ReferenceProjectSection />
      <FounderSection />
    </>
  );
}
