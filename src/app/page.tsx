'use client';

import { useEffect, useState, useTransition, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, subDays, eachDayOfInterval, startOfISOWeek, endOfISOWeek } from 'date-fns';
import { formatDistanceToNow } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { fetchCommits, rewriteCommitWithAI } from './actions';
import { GitBranch, Wand2, Loader2, GitCommit, Copy, Check, ExternalLink, Users } from 'lucide-react';
import { Area, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart, AreaChart } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const formSchema = z.object({
  repoUrl: z.string().url({ message: "Please enter a valid GitHub repository URL." }).refine(
    (url) => url.startsWith('https://github.com/'),
    "URL must be a valid GitHub repository link (e.g., https://github.com/owner/repo)."
  ),
});

type Commit = Awaited<ReturnType<typeof fetchCommits>>['commits'] extends (infer U)[] ? U : never;

type RewriteData = {
  original: string;
  rewritten: string;
};

type Contributor = {
    login: string;
    name: string;
    avatar_url: string;
    totalCommits: number;
    dailyCommits: { date: string; commits: number }[];
};

type ChartData = {
    allCommits: { date: string; commits: number }[];
    contributors: Contributor[];
};

export default function Home() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string; url: string } | null>(null);
  const [isFetchingCommits, startFetchingTransition] = useTransition();

  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteData, setRewriteData] = useState<RewriteData | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);

  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  
  const [timeRange, setTimeRange] = useState('30d');


  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      repoUrl: '',
    },
  });

  const chartData: ChartData | null = useMemo(() => {
    if (commits.length === 0) return null;

    let startDate: Date;
    const endDate = new Date();

    switch (timeRange) {
        case '7d':
            startDate = subDays(endDate, 6);
            break;
        case '30d':
            startDate = subDays(endDate, 29);
            break;
        case 'this_week':
            startDate = startOfISOWeek(endDate);
            break;
        case 'this_month':
            startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
            break;
        default:
            startDate = subDays(endDate, 29);
    }
    
    if (timeRange === 'this_week') {
      startDate = startOfISOWeek(new Date());
    }

    const dateInterval = eachDayOfInterval({ start: startDate, end: endDate });
    const allTimeDateInterval = commits.length > 0 ? eachDayOfInterval({start: new Date(commits[commits.length-1].commit.author.date), end: new Date()}) : [];

    const dateMap = new Map(dateInterval.map(d => [format(d, 'yyyy-MM-dd'), 0]));
    
    const contributorMap = new Map<string, { name: string; avatar_url: string; totalCommits: number; commits: Map<string, number> }>();
    
    // Calculate totals and metadata for all contributors across all commits
    commits.forEach(commit => {
        const author = commit.author;
        if (author) {
            if (!contributorMap.has(author.login)) {
                contributorMap.set(author.login, {
                    name: commit.commit.author.name,
                    avatar_url: author.avatar_url,
                    totalCommits: 0,
                    commits: new Map(dateInterval.map(d => [format(d, 'yyyy-MM-dd'), 0]))
                });
            }
            const contributor = contributorMap.get(author.login)!;
            contributor.totalCommits += 1;
        }
    });


    // Then, populate date-specific maps for the selected time range
    commits.forEach(commit => {
        const commitDate = new Date(commit.commit.author.date);
        const commitDateString = format(commitDate, 'yyyy-MM-dd');
        
        if (dateMap.has(commitDateString)) {
            dateMap.set(commitDateString, (dateMap.get(commitDateString) || 0) + 1);
            const author = commit.author;
            if (author && contributorMap.has(author.login)) {
                const contributor = contributorMap.get(author.login)!;
                contributor.commits.set(commitDateString, (contributor.commits.get(commitDateString) || 0) + 1);
            }
        }
    });

    const allCommits = Array.from(dateMap.entries()).map(([date, commits]) => ({
        date: format(new Date(date), 'MMM dd'),
        commits
    })).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const contributors: Contributor[] = Array.from(contributorMap.entries()).map(([login, data]) => {
        const dailyCommits = Array.from(data.commits.entries()).map(([date, commits]) => ({
            date: format(new Date(date), 'MMM dd'),
            commits
        })).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        return {
            login,
            name: data.name,
            avatar_url: data.avatar_url,
            totalCommits: data.totalCommits,
            dailyCommits
        };
    }).sort((a, b) => b.totalCommits - a.totalCommits).filter(c => c.totalCommits > 0);

    return { allCommits, contributors };
  }, [commits, timeRange]);


  const handleFetchCommits = (repoUrl: string) => {
    startFetchingTransition(async () => {
      setCommits([]);
      setRepoInfo(null);
      window.history.pushState({}, '', `?repo=${encodeURIComponent(repoUrl)}`);
      
      try {
        const url = new URL(repoUrl);
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) {
          throw new Error('Invalid GitHub repository URL path.');
        }
        const owner = pathParts[0];
        const repo = pathParts[1].replace(/\.git$/, '');
        const repoData = { owner, repo, url: repoUrl };

        const result = await fetchCommits(owner, repo);

        if (result.error) {
          throw new Error(result.error);
        }

        setCommits(result.commits || []);
        setRepoInfo(repoData);
      } catch (e: any) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: e.message || 'An unexpected error occurred.',
        });
      }
    });
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    handleFetchCommits(values.repoUrl);
  };
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const repoFromQuery = params.get('repo');
    if (repoFromQuery) {
      const validation = formSchema.safeParse({ repoUrl: repoFromQuery });
      if (validation.success) {
        form.setValue('repoUrl', repoFromQuery);
        handleFetchCommits(repoFromQuery);
      } else {
        toast({
            variant: 'destructive',
            title: 'Invalid URL in query parameter',
            description: validation.error.errors[0].message
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRewriteClick = (commit: Commit) => {
    if (!repoInfo) return;
    setSelectedCommit(commit);
    setIsRewriting(true);
    setRewriteData(null);
    
    rewriteCommitWithAI(repoInfo.owner, repoInfo.repo, commit.sha)
      .then(result => {
        if (result.error) {
          throw new Error(result.error);
        }
        setRewriteData({
          original: result.originalMessage!,
          rewritten: result.rewrittenMessage!,
        });
      })
      .catch(e => {
        toast({
          variant: 'destructive',
          title: 'AI Rewrite Failed',
          description: e.message || 'Could not rewrite commit message.',
        });
        setSelectedCommit(null);
      })
      .finally(() => {
        setIsRewriting(false);
      });
  };

  const handleCopy = () => {
    if (rewriteData?.rewritten) {
      navigator.clipboard.writeText(rewriteData.rewritten);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen p-4 md:p-8">
      <header className="w-full max-w-5xl mb-10 text-center relative">
         <div className="absolute -top-10 -left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl -z-10"></div>
         <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-secondary/20 rounded-full blur-3xl -z-10"></div>
        <div className="flex items-center justify-center gap-4 mb-2">
          <div className="p-3 bg-primary/10 rounded-lg">
            <GitBranch className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-headline bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            GitView
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">Visualize repository history and enhance commit messages with AI.</p>
      </header>
      
      <main className="w-full max-w-5xl">
        <Card className="shadow-lg bg-card/70 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle className="font-headline text-2xl">Select Repository</CardTitle>
            <CardDescription>Enter a public GitHub repository URL to visualize its commit history.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-4">
                <FormField
                  control={form.control}
                  name="repoUrl"
                  render={({ field }) => (
                    <FormItem className="flex-grow">
                      <FormLabel className="sr-only">Repository URL</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., https://github.com/facebook/react" {...field} className="h-12 text-base"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isFetchingCommits} size="lg" className="h-12 text-base font-bold">
                  {isFetchingCommits ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Visualize'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        
        {(isFetchingCommits || chartData) && (
            <Card className="mt-8 bg-card/70 backdrop-blur-sm border-border/50">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div>
                            <CardTitle className="font-headline text-xl flex items-center gap-2"><Users className="w-5 h-5 text-primary"/> Contributor Activity</CardTitle>
                            <CardDescription>An overview of commit activity.</CardDescription>
                        </div>
                         <Tabs value={timeRange} onValueChange={setTimeRange}>
                            <TabsList className="grid w-full grid-cols-4 h-auto">
                                <TabsTrigger value="7d">7 Days</TabsTrigger>
                                <TabsTrigger value="30d">30 Days</TabsTrigger>
                                <TabsTrigger value="this_week">This Week</TabsTrigger>
                                <TabsTrigger value="this_month">This Month</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>
                </CardHeader>
                <CardContent>
                    {isFetchingCommits ? <Skeleton className="h-[200px] w-full" /> : (
                         <ChartContainer config={{}} className="h-[200px] w-full">
                            <ComposedChart data={chartData?.allCommits} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCommits" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
                                <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} allowDecimals={false} />
                                <Tooltip
                                    content={({ active, payload, label }) =>
                                    active && payload && payload.length ? (
                                        <div className="p-2 bg-background/90 border border-border/50 rounded-lg shadow-lg">
                                            <p className="font-bold text-base">{`${label}`}</p>
                                            <p className="text-sm text-primary">{`Commits: ${payload[0].value}`}</p>
                                        </div>
                                    ) : null
                                }
                                />
                                <Area type="monotone" dataKey="commits" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorCommits)" />
                            </ComposedChart>
                        </ChartContainer>
                    )}
                </CardContent>
                <CardFooter className="flex flex-col items-start gap-4 pt-4 border-t border-border/50">
                     <h3 className="text-lg font-headline">All Contributors</h3>
                     {isFetchingCommits ? (
                        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[88px] w-full" />)}
                        </div>
                     ) : (
                        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
                             {chartData?.contributors && chartData.contributors.length > 0 ? chartData.contributors.map(c => (
                                <Card key={c.login} className="w-full bg-muted/30">
                                    <CardHeader className="flex flex-row items-center gap-4 p-4">
                                        <Avatar>
                                            <AvatarImage src={c.avatar_url} alt={c.login} />
                                            <AvatarFallback>{c.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-grow">
                                            <p className="font-bold">{c.name}</p>
                                            <p className="text-sm text-muted-foreground">{c.totalCommits} commits</p>
                                        </div>
                                         <div className="w-[100px] h-[40px]">
                                             <ResponsiveContainer width="100%" height="100%">
                                                 <AreaChart data={c.dailyCommits} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                                      <defs>
                                                        <linearGradient id={`color-contrib-${c.login}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                                                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                                                        </linearGradient>
                                                    </defs>
                                                    <Tooltip
                                                        content={() => null}
                                                        cursor={{stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '3 3'}}
                                                    />
                                                     <Area type="monotone" dataKey="commits" stroke="hsl(var(--primary))" strokeWidth={1.5} fillOpacity={1} fill={`url(#color-contrib-${c.login})`} />
                                                 </AreaChart>
                                             </ResponsiveContainer>
                                         </div>
                                    </CardHeader>
                                </Card>
                            )) : <p className="text-muted-foreground">No contributor data available for this period.</p>}
                        </div>
                     )}
                </CardFooter>
            </Card>
        )}

        {form.formState.errors.repoUrl && !isFetchingCommits && (
           <Card className="mt-8 text-center text-destructive-foreground bg-destructive/90">
             <CardContent className="p-6">
               <p>{form.formState.errors.repoUrl.message}</p>
             </CardContent>
           </Card>
        )}

        {commits.length > 0 && !isFetchingCommits && (
          <div className="mt-12">
            <h2 className="text-3xl font-bold text-center mb-8 font-headline">Commit History</h2>
            <div className="relative pl-6 sm:pl-8 border-l-2 border-dashed border-primary/20">
              {commits.map((commit, index) => (
                <div key={commit.sha} className="relative mb-8">
                  <div className="absolute top-5 -left-[1.7rem] sm:-left-[2.2rem] transform">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 bg-background flex items-center justify-center rounded-full">
                        <GitCommit className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                    </div>
                  </div>
                  <Card className="ml-4 sm:ml-6 hover:shadow-2xl hover:border-primary/50 transition-all duration-300 bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-4">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={commit.author?.avatar_url} alt={commit.author?.login} />
                            <AvatarFallback>{commit.author?.login?.charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <CardTitle className="text-base font-medium">{commit.commit.author.name}</CardTitle>
                            <CardDescription>
                              committed {formatDistanceToNow(new Date(commit.commit.author.date), { addSuffix: true })}
                            </CardDescription>
                          </div>
                        </div>
                        <a href={commit.html_url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 pt-1">
                          {commit.sha.substring(0, 7)} <ExternalLink className="w-3 h-3"/>
                        </a>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="font-medium text-lg text-foreground/90">{commit.commit.message.split('\n')[0]}</p>
                      {commit.commit.message.split('\n').slice(1).join('\n').trim() && (
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap font-mono border-l-2 border-border/50 pl-4 py-2 bg-black/10 rounded-r-md">
                          {commit.commit.message.split('\n').slice(1).join('\n')}
                        </p>
                      )}
                    </CardContent>
                    <CardFooter className="flex justify-end items-center text-sm p-4">
                      <Button variant="outline" size="sm" onClick={() => handleRewriteClick(commit)} disabled={isRewriting && selectedCommit?.sha === commit.sha}>
                         {isRewriting && selectedCommit?.sha === commit.sha ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                        Rewrite with AI
                      </Button>
                    </CardFooter>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        )}

        <AlertDialog open={!!selectedCommit} onOpenChange={(open) => !open && setSelectedCommit(null)}>
          <AlertDialogContent className="max-w-2xl bg-background/80 backdrop-blur-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-headline text-2xl flex items-center gap-3">
                <Wand2 className="text-primary"/> AI Commit Message Rewrite
              </AlertDialogTitle>
              <AlertDialogDescription>
                The AI has analyzed the commit changes and suggested a more descriptive message.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {isRewriting ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-muted-foreground">AI is analyzing the diff...</p>
              </div>
            ) : rewriteData ? (
              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 -mr-2">
                <div>
                  <h3 className="font-semibold mb-2 text-muted-foreground">Original Message</h3>
                  <div className="p-4 rounded-md border bg-muted/30 text-sm whitespace-pre-wrap font-mono">{rewriteData.original}</div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-primary">AI Rewritten Message</h3>
                    <Button variant="ghost" size="sm" onClick={handleCopy}>
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      <span className="ml-2">{copied ? 'Copied!' : 'Copy'}</span>
                    </Button>
                  </div>
                  <div className="p-4 rounded-md border border-primary/50 bg-primary/10 text-sm whitespace-pre-wrap font-mono">{rewriteData.rewritten}</div>
                </div>
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setSelectedCommit(null);
                setRewriteData(null);
              }}>Close</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
