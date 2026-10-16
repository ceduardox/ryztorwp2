import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginRequest } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MessageSquare, Loader2, Sparkles, User, Lock, Zap } from "lucide-react";

const floatingAnimation = `
@keyframes float {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(-20px) rotate(5deg); }
}
@keyframes float-reverse {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(20px) rotate(-5deg); }
}
@keyframes pulse-glow {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.1); }
}
.animate-float { animation: float 6s ease-in-out infinite; }
.animate-float-reverse { animation: float-reverse 8s ease-in-out infinite; }
.animate-pulse-glow { animation: pulse-glow 4s ease-in-out infinite; }
`;

export default function LoginPage() {
  const { login, isLoggingIn } = useAuth();
  const savedUsername = typeof window !== "undefined" ? localStorage.getItem("login_saved_username") ?? "" : "";
  
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: savedUsername,
      password: "",
      remember: savedUsername.length > 0,
    },
  });

  const onSubmit = (data: LoginRequest) => {
    if (typeof window !== "undefined") {
      if (data.remember) {
        localStorage.setItem("login_saved_username", data.username);
      } else {
        localStorage.removeItem("login_saved_username");
      }
    }
    login(data);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: floatingAnimation }} />
      
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-500/20 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/4 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: '4s' }} />
        
        {/* Floating shapes */}
        <div className="absolute top-32 right-20 w-4 h-4 bg-emerald-400/40 rounded-full animate-float" />
        <div className="absolute top-48 left-20 w-3 h-3 bg-cyan-400/40 rounded-full animate-float-reverse" />
        <div className="absolute bottom-32 left-32 w-5 h-5 bg-teal-400/30 rounded-full animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-48 right-32 w-2 h-2 bg-emerald-300/50 rounded-full animate-float-reverse" style={{ animationDelay: '3s' }} />
        
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8 space-y-4">
          <div className="relative inline-block">
            <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-2xl shadow-emerald-500/30 border border-white/20 animate-float">
              <MessageSquare className="h-12 w-12 text-white" />
            </div>
            <div className="absolute -top-2 -right-2 h-8 w-8 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full flex items-center justify-center shadow-lg animate-pulse">
              <Zap className="h-4 w-4 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Ryztor Agent <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">IA</span>
          </h1>
          <p className="text-emerald-200/70 text-sm flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4" />
            Tu asistente de ventas inteligente
            <Sparkles className="h-4 w-4" />
          </p>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-xl rounded-3xl shadow-2xl p-8 space-y-6 border border-white/10">
          <div className="text-center mb-4">
            <h2 className="text-xl font-semibold text-white">Acceso al Panel</h2>
            <p className="text-sm text-slate-400">Ingresa tus credenciales</p>
          </div>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-300 font-medium text-sm">Usuario</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                        <Input 
                          placeholder="Tu usuario" 
                          {...field} 
                          className="h-12 pl-12 rounded-xl bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:bg-slate-700 focus:border-emerald-500 focus:ring-emerald-500/20 transition-all"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-300 font-medium text-sm">Contraseña</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                        <Input 
                          type="password" 
                          placeholder="••••••••" 
                          {...field} 
                          className="h-12 pl-12 rounded-xl bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:bg-slate-700 focus:border-emerald-500 focus:ring-emerald-500/20 transition-all"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="remember"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        className="border-slate-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                      />
                    </FormControl>
                    <FormLabel className="text-slate-300 text-sm font-normal cursor-pointer">
                      Guardar datos
                    </FormLabel>
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                disabled={isLoggingIn}
                className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 shadow-lg shadow-emerald-500/30 transition-all border-0"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Ingresando...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-5 w-5" />
                    Iniciar Sesión
                  </>
                )}
              </Button>
            </form>
          </Form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6 flex items-center justify-center gap-2">
          <span className="h-1 w-1 bg-emerald-500 rounded-full animate-pulse" />
          Potenciado con Inteligencia Artificial
          <span className="h-1 w-1 bg-emerald-500 rounded-full animate-pulse" />
        </p>

        <p className="text-center text-xs text-slate-500 mt-3">
          Developed by{" "}
          <a
            href="https://ryztor.us/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            RYZTOR
          </a>
        </p>
      </div>
    </div>
  );
}
