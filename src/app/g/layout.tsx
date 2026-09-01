import { ToastProvider } from '@/components/Toast'

/**
 * The shell for people who do not work here.
 *
 * Everything the app layout provides except the parts that assume a session:
 * no sidebar, no module list, no way to reach anything but this one link.
 * The toast layer is here because uploads and saves still have to say what
 * followed from them — `useToast` falls back to a no-op without a provider,
 * which would leave an artist pressing a button that appears to do nothing.
 */
export default function GrantLayout({ children }: LayoutProps<'/g'>) {
  return <ToastProvider>{children}</ToastProvider>
}
