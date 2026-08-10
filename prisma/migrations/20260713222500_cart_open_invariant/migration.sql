WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC, id DESC) AS row_number
  FROM "payment"."cart"
  WHERE status = 'OPEN'
)
UPDATE "payment"."cart" AS cart
SET status = 'ABANDONED', "updatedAt" = now()
FROM ranked
WHERE cart.id = ranked.id AND ranked.row_number > 1;

CREATE UNIQUE INDEX "cart_one_open_per_user_key"
  ON "payment"."cart"("userId")
  WHERE status = 'OPEN';
