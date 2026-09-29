-- Tăng cường xác thực: vai trò tiếp nhận, khóa tài khoản tạm thời, nhật ký kiểm toán bất biến.
-- Phiên đăng nhập cũ lưu token dạng rõ nên bị thu hồi; cán bộ chỉ cần đăng nhập lại.
DELETE FROM public.sessions;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'coordinator', 'inspector', 'receptionist', 'citizen'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS locked_until TEXT;

CREATE OR REPLACE FUNCTION public.audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Nhật ký kiểm toán chỉ được ghi thêm' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS audit_logs_no_change ON public.audit_logs;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_append_only();
REVOKE UPDATE, DELETE ON public.audit_logs FROM qlttxd_backend;
