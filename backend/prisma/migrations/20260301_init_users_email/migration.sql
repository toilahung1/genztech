-- Migration: Chuyển từ username sang email, thêm FB info columns
-- Chạy an toàn: bỏ qua nếu cột đã tồn tại

-- Xóa cột username nếu tồn tại (cột cũ)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='username') THEN
    ALTER TABLE "users" DROP COLUMN IF EXISTS "username";
  END IF;
END $$;

-- Thêm cột email nếu chưa có
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email') THEN
    ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
  END IF;
END $$;

-- Thêm các cột FB info nếu chưa có
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='fbUserName') THEN
    ALTER TABLE "users" ADD COLUMN "fbUserName" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='fbAvatar') THEN
    ALTER TABLE "users" ADD COLUMN "fbAvatar" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='fbUserId') THEN
    ALTER TABLE "users" ADD COLUMN "fbUserId" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='fbToken') THEN
    ALTER TABLE "users" ADD COLUMN "fbToken" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='fbTokenExp') THEN
    ALTER TABLE "users" ADD COLUMN "fbTokenExp" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='fbPages') THEN
    ALTER TABLE "users" ADD COLUMN "fbPages" JSONB DEFAULT '[]';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='lastLogin') THEN
    ALTER TABLE "users" ADD COLUMN "lastLogin" TIMESTAMP(3);
  END IF;
END $$;
