import { useMemo, useState, type FormEvent } from 'react';
import type { RegisterPayload } from '../types/api';

interface RegistrationFormProps {
  loading: boolean;
  onSubmit: (payload: RegisterPayload) => Promise<void>;
}

type FormErrors = Partial<Record<keyof RegisterPayload, string>>;

const initialForm: RegisterPayload = {
  firstName: '',
  lastName: '',
  email: '',
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegistrationForm({ loading, onSubmit }: RegistrationFormProps) {
  const [form, setForm] = useState<RegisterPayload>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});

  const fields = useMemo(
    () => [
      { key: 'firstName', label: 'Имя', type: 'text' },
      { key: 'lastName', label: 'Фамилия', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
    ] as const,
    [],
  );

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};

    if (!form.firstName.trim()) nextErrors.firstName = 'Введите имя';
    if (!form.lastName.trim()) nextErrors.lastName = 'Введите фамилию';
    if (!emailPattern.test(form.email.trim())) nextErrors.email = 'Введите корректный email';

    return nextErrors;
  };

  const handleChange = (key: keyof RegisterPayload, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    await onSubmit({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
    });
  };

  return (
    <section className="rounded-[28px] border border-slate-200/70 bg-white/90 p-5 shadow-panel backdrop-blur xl:p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
          Регистрация
        </p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Лицо не найдено в системе</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Заполните короткую анкету. Для регистрации будет использован уже захваченный
          кадр после успешной проверки активности.
        </p>
      </div>

      <form className="grid gap-4" onSubmit={handleSubmit}>
        {fields.map((field) => {
          const error = errors[field.key];

          return (
            <label key={field.key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{field.label}</span>
              <input
                type={field.type}
                value={form[field.key]}
                onChange={(event) => handleChange(field.key, event.target.value)}
                autoComplete={
                  field.key === 'firstName'
                    ? 'given-name'
                    : field.key === 'lastName'
                      ? 'family-name'
                      : 'email'
                }
                className={`w-full rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-accent focus:bg-white ${
                  error ? 'border-red-300' : 'border-slate-200'
                }`}
                placeholder={`Введите ${field.label.toLowerCase()}`}
              />
              {error ? <span className="mt-2 block text-xs text-danger">{error}</span> : null}
            </label>
          );
        })}

        <div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? 'Регистрация...' : 'Зарегистрировать пользователя'}
          </button>
        </div>
      </form>
    </section>
  );
}
