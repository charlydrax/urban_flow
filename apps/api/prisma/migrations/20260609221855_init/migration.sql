-- Enable PostGIS (geospatial queries: ST_DWithin for nearby cycle paths, etc. - C6/C9).
-- Added manually: Prisma does not manage PostgreSQL extensions in stable releases.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "consent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobility_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "preferred_modes" TEXT[],
    "reduced_mobility" BOOLEAN NOT NULL DEFAULT false,
    "max_walk_minutes" INTEGER NOT NULL DEFAULT 15,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobility_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_label" TEXT NOT NULL,
    "from_lat" DOUBLE PRECISION,
    "from_lng" DOUBLE PRECISION,
    "to_label" TEXT NOT NULL,
    "to_lat" DOUBLE PRECISION,
    "to_lng" DOUBLE PRECISION,
    "selected_summary" TEXT,
    "carbon_grams" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "mobility_profiles_user_id_key" ON "mobility_profiles"("user_id");

-- CreateIndex
CREATE INDEX "search_history_user_id_created_at_idx" ON "search_history"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "mobility_profiles" ADD CONSTRAINT "mobility_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
